import AVFoundation
import Speech
import SwiftUI

enum LocalModelMode: String, CaseIterable {
  case apple
  case custom
}

/// Meter changes redraw only the waveform, keeping the saved worksheet out of the audio loop.
@MainActor
final class MicrophoneMeter: ObservableObject {
  @Published var levels: [Float] = []
}

@MainActor
final class AudioController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
  @Published private(set) var modelMode: LocalModelMode = .apple
  @Published var isSpeaking = false
  @Published var isListening = false
  @Published var isStarting = false
  @Published private(set) var isTranscribing = false
  private var customRecorder: AVAudioRecorder?
  private var customRecordingURL: URL?
  private var ownsCustomRecording = false
  private var customDecode: Task<Void, Never>?
  private var customMeterTask: Task<Void, Never>?
  private var verificationSynthesizer: AVSpeechSynthesizer?
  private var speechGeneration: UInt = 0
  private var recognitionGeneration: UInt = 0
  var onRecognizedCommand: ((String) -> Void)?
  @Published var transcript = ""
  let microphoneMeter = MicrophoneMeter()
  @Published private(set) var voiceFailure: String?
  @Published private(set) var isPreparingVoice = false
  @Published var status = ""
  private var synthesizer: AVSpeechSynthesizer?
  private var engine: AVAudioEngine?
  private var toneEngine: AVAudioEngine?
  private var tonePlayer: AVAudioPlayerNode?
  private var tonesAttached = false
  private var recordingSessionActive = false
  private var toneSessionActive = false
  var speechRate: Float = AVSpeechUtteranceDefaultSpeechRate * 0.85
  private lazy var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var hasTap = false
  private var timeout: Task<Void, Never>?

  override init() {
    super.init()
  }

  /// Stops current audio when switching providers; unavailable custom models never fall back to Apple.
  func selectModelMode(_ mode: LocalModelMode) {
    guard mode != modelMode else { return }
    stopListening()
    stopSpeaking()
    modelMode = mode
    voiceFailure = nil
    status = ""
  }

  /// Blocks unavailable custom recognition before system permissions or model downloads.
  private func requireAppleSpeech() -> Bool {
    guard modelMode == .apple else {
      status = "Apple speech setup applies only to Apple mode."
      voiceFailure = status
      return false
    }
    return true
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance
  ) {
    Task { @MainActor in self.isSpeaking = true }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    Task { @MainActor in self.isSpeaking = false }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
  ) {
    Task { @MainActor in self.isSpeaking = false }
  }

  func speak(_ text: String) {
    stopListening()
    stopSpeaking()
    let synthesizer: AVSpeechSynthesizer
    if let existing = self.synthesizer {
      synthesizer = existing
    } else {
      synthesizer = AVSpeechSynthesizer()
      synthesizer.delegate = self
      self.synthesizer = synthesizer
    }
    #if os(iOS)
      // Let speech use its own session after the recording session is deactivated.
      synthesizer.usesApplicationAudioSession = false
    #endif
    let readable = text.replacingOccurrences(of: "²", with: " squared ")
      .replacingOccurrences(of: "*", with: " times ")
      .replacingOccurrences(of: "/", with: " divided by ")
      .replacingOccurrences(of: "=", with: " equals ")
      .replacingOccurrences(of: "√", with: " square root of ")
      .replacingOccurrences(of: "±", with: " plus or minus ")
    let utterance = AVSpeechUtterance(string: readable)
    utterance.rate = speechRate
    utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
    NativeVerification.event("readbackstarted", ["text": readable])
    #if DEBUG
      if let path = NativeVerification.path("MATHWAVE_VERIFICATION_READBACK_PATH") {
        let capture = AVSpeechSynthesizer()
        verificationSynthesizer = capture
        let captured = AVSpeechUtterance(string: readable)
        captured.rate = speechRate
        captured.voice = utterance.voice
        let writer = VerificationSpeechWriter(path: path)
        let generation = speechGeneration
        capture.write(captured) { [weak self] buffer in
          do {
            if try writer.append(buffer) {
              Task { @MainActor [weak self] in
                guard self?.speechGeneration == generation else { return }
                NativeVerification.event(
                  "readbackcompleted", ["path": path.path, "kind": "AVSpeechSynthesizer.write"])
              }
            }
          } catch {
            Task { @MainActor in
              NativeVerification.event("readbackfailed", ["error": error.localizedDescription])
            }
          }
        }
      }
    #endif
    synthesizer.speak(utterance)
  }

  func stopSpeaking() {
    speechGeneration &+= 1
    isSpeaking = false
    synthesizer?.stopSpeaking(at: .immediate)
    verificationSynthesizer?.stopSpeaking(at: .immediate)
    verificationSynthesizer = nil
    tonePlayer?.stop()
    toneEngine?.stop()
    #if os(iOS)
      if toneSessionActive {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        toneSessionActive = false
      }
    #endif
  }

  /// Plays bounded values as pitches, preserving undefined samples as silence.
  /// Each playback normalizes its own range and stops recording and prior audio.
  func sonify(_ values: [Double?]) {
    stopListening()
    stopSpeaking()
    let samples = Array(values.prefix(201))
    let finite = samples.compactMap { $0 }.filter { $0.isFinite }
    guard let low = finite.min(), let high = finite.max(), !samples.isEmpty else {
      status = "No finite values are available to play."
      return
    }
    let rate = 22_050.0
    let framesPerValue = 661
    guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count * framesPerValue)),
      let channel = buffer.floatChannelData?[0]
    else { return }
    buffer.frameLength = buffer.frameCapacity
    for (index, value) in samples.enumerated() {
      let normalized = value.map { high == low ? 0.5 : ($0 - low) / (high - low) } ?? 0
      let frequency = 220 * pow(4, normalized)
      for frame in 0..<framesPerValue {
        let envelope = min(1, Double(min(frame, framesPerValue - 1 - frame)) / 80)
        channel[index * framesPerValue + frame] =
          value?.isFinite == true
          ? Float(sin(2 * .pi * frequency * Double(frame) / rate) * 0.15 * envelope) : 0
      }
    }
    do {
      #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try AVAudioSession.sharedInstance().setActive(true)
        toneSessionActive = true
      #endif
      let toneEngine: AVAudioEngine
      if let existing = self.toneEngine {
        toneEngine = existing
      } else {
        toneEngine = AVAudioEngine()
        self.toneEngine = toneEngine
      }
      if !tonesAttached {
        let player = AVAudioPlayerNode()
        toneEngine.attach(player)
        toneEngine.connect(player, to: toneEngine.mainMixerNode, format: format)
        tonePlayer = player
        tonesAttached = true
      }
      try toneEngine.start()
      tonePlayer?.scheduleBuffer(buffer)
      tonePlayer?.play()
      status =
        "Playing values from left to right. Higher pitches mean larger values within this view."
    } catch { status = "Audio could not play: \(error.localizedDescription)" }
  }

  /// Asks Apple's asset manager to prepare English; verifies executable model formats afterward.
  /// Setup may download model files. Recognition never uploads recorded audio.
  func prepareEnglishSpeech() async {
    guard requireAppleSpeech() else { return }
    guard !isPreparingVoice else { return }
    stopListening()
    isPreparingVoice = true
    defer { isPreparingVoice = false }
    guard #available(iOS 26.0, macOS 26.0, *) else {
      status = "English dictation must be installed through system settings on this version."
      voiceFailure = status
      return
    }
    status = "Checking English speech files…"
    let module = DictationTranscriber(locale: Locale(identifier: "en-US"), preset: .shortDictation)
    let availability = await AssetInventory.status(forModules: [module])
    guard modelMode == .apple else { return }
    guard availability != .unsupported else {
      status =
        "This runtime cannot install English speech. Use another simulator runtime or an iPhone for voice."
      voiceFailure = status
      return
    }
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
        guard modelMode == .apple else { return }
        status = "Downloading English speech files from Apple. Internet is needed for setup only."
        try await request.downloadAndInstall()
      }
      let formats = await module.availableCompatibleAudioFormats
      guard modelMode == .apple else { return }
      guard !formats.isEmpty else {
        status =
          "English speech is registered as installed, but this runtime cannot load it. Use another simulator runtime or an iPhone for voice."
        voiceFailure = status
        return
      }
      recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
      status = "English speech files passed the setup check. Try Voice input again."
      voiceFailure = nil
    } catch {
      guard modelMode == .apple else { return }
      status = "English speech setup could not finish. Check your connection and try again."
      voiceFailure = status
    }
  }

  func toggleListening() async {
    if modelMode == .custom {
      await toggleCustomListening()
      return
    }
    guard requireAppleSpeech() else { return }
    guard !isPreparingVoice else { return }
    if isStarting {
      stopListening()
      status = "Voice startup cancelled."
      return
    }
    if isTranscribing {
      stopListening()
      status = "Stopped."
      return
    }
    if isListening {
      finishAppleRecording()
      return
    }
    stopSpeaking()
    voiceFailure = nil
    guard let recognizer, recognizer.supportsOnDeviceRecognition else {
      status =
        "On-device English recognition is unavailable on this device. Check English speech setup and try again."
      voiceFailure = status
      return
    }
    recognitionGeneration &+= 1
    let startupGeneration = recognitionGeneration
    isStarting = true
    defer { if startupGeneration == recognitionGeneration { isStarting = false } }
    let speechAllowed = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { result in
        continuation.resume(returning: result == .authorized)
      }
    }
    guard startupGeneration == recognitionGeneration else { return }
    guard speechAllowed else {
      status =
        "Speech permission is off. Enable it in system privacy settings and try again."
      voiceFailure = status
      return
    }
    let micAllowed = await AVCaptureDevice.requestAccess(for: .audio)
    guard startupGeneration == recognitionGeneration else { return }
    guard micAllowed else {
      status =
        "Microphone permission is off. Enable it in system privacy settings and try again."
      voiceFailure = status
      return
    }
    guard recognizer.isAvailable else {
      status = "On-device recognition is currently unavailable. Try again."
      voiceFailure = status
      return
    }
    do {
      #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
          .playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        recordingSessionActive = true
      #endif
      let engine: AVAudioEngine
      if let existing = self.engine {
        engine = existing
      } else {
        engine = AVAudioEngine()
        self.engine = engine
      }
      let newRequest = SFSpeechAudioBufferRecognitionRequest()
      newRequest.requiresOnDeviceRecognition = true
      newRequest.shouldReportPartialResults = true
      newRequest.taskHint = .dictation
      newRequest.contextualStrings = [
        "read equation", "solve", "undo", "new session", "x squared", "replace", "statistics",
      ]
      request = newRequest
      transcript = ""
      let node = engine.inputNode
      let format = node.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        throw NSError(
          domain: "MathAudio", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "No active microphone was found."])
      }
      node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
        newRequest.append(buffer)
        // Copy measured amplitudes before the audio thread reuses this buffer.
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        let count = Int(buffer.frameLength)
        let levels: [Float] = (0..<32).map { bin in
          let start = bin * count / 32
          let end = max(start + 1, (bin + 1) * count / 32)
          var energy: Float = 0
          for index in start..<min(end, count) { energy += samples[index] * samples[index] }
          return min(1, sqrt(energy / Float(end - start)) * 8)
        }
        Task { @MainActor in
          guard let self, self.isListening, self.recognitionGeneration == startupGeneration else {
            return
          }
          self.microphoneMeter.levels = levels
        }
      }
      hasTap = true
      task = recognizer.recognitionTask(with: newRequest) { [weak self] result, error in
        Task { @MainActor in
          guard let self, self.isListening || self.isTranscribing,
            self.recognitionGeneration == startupGeneration else { return }
          if let error {
            // An error may accompany a final result; never execute that result.
            if let result { self.transcript = result.bestTranscription.formattedString }
            self.stopListening()
            #if targetEnvironment(simulator)
              let simulator = true
            #else
              let simulator = false
            #endif
            self.status = SpeechFailureDescription.message(error as NSError, simulator: simulator)
            self.voiceFailure = self.status
            NSLog(
              "Mathwave speech failure: %@ %ld", (error as NSError).domain, (error as NSError).code)
          } else if let result {
            self.receiveRecognizedText(result.bestTranscription.formattedString, isFinal: result.isFinal)
          }
        }
      }
      engine.prepare()
      try engine.start()
      isListening = true
      status = ""
      timeout = Task { [weak self] in
        try? await Task.sleep(nanoseconds: 45_000_000_000)
        guard !Task.isCancelled, let self, self.recognitionGeneration == startupGeneration else { return }
        self.finishAppleRecording()
      }
    } catch {
      stopListening()
      status = "Voice input could not start: \(error.localizedDescription)"
      voiceFailure = status
    }
  }

  /// Records custom speech locally, then decodes the complete bounded clip on stop.
  /// - Uses microphone permission only; Apple speech recognition is never a fallback.
  /// - A provider change or cancellation invalidates all pending transcript updates.
  private func toggleCustomListening() async {
    if isListening {
      finishCustomRecording()
      return
    }
    if isStarting || isTranscribing {
      stopListening()
      status = "Stopped."
      return
    }
    guard CustomModelRuntime.isInstalled else {
      status = CustomModelRuntime.installationStatus
      voiceFailure = status
      return
    }
    stopSpeaking()
    recognitionGeneration &+= 1
    let generation = recognitionGeneration
    isStarting = true
    voiceFailure = nil
    defer { if generation == recognitionGeneration { isStarting = false } }
    do {
      #if DEBUG
        if let fixture = NativeVerification.path("MATHWAVE_VERIFICATION_AUDIO_PATH") {
          transcript = ""
          customRecordingURL = fixture
          ownsCustomRecording = false
          isListening = true
          isStarting = false
          NativeVerification.event(
            "customRecordingStarted", ["source": "recorded-fixture", "path": fixture.path])
          // The fixture follows the same file decoder and transcription path as a microphone clip.
          timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let self, self.recognitionGeneration == generation else {
              return
            }
            self.finishCustomRecording(removeRecording: false)
          }
          return
        }
      #endif
      let allowed = await AVCaptureDevice.requestAccess(for: .audio)
      guard generation == recognitionGeneration, modelMode == .custom else { return }
      guard allowed else {
        throw CustomAudioFailure(
          "Microphone permission is off. Enable it in system privacy settings.")
      }
      #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
        try session.setActive(true)
        recordingSessionActive = true
      #endif
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(
        "mathwave-\(UUID().uuidString).caf")
      let recorder = try AVAudioRecorder(
        url: url,
        settings: [
          AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000,
          AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 32,
          AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
        ])
      recorder.isMeteringEnabled = true
      guard recorder.record(forDuration: 30) else {
        throw CustomAudioFailure("Microphone recording could not start.")
      }
      customRecorder = recorder
      customRecordingURL = url
      ownsCustomRecording = true
      transcript = ""
      isListening = true
      status = ""
      NativeVerification.event("customRecordingStarted", ["source": "microphone"])
      customMeterTask = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(nanoseconds: 70_000_000)
          guard !Task.isCancelled, let self, self.recognitionGeneration == generation,
            let recorder = self.customRecorder
          else { return }
          recorder.updateMeters()
          self.microphoneMeter.levels = Array(
            repeating: min(1, pow(10, recorder.averagePower(forChannel: 0) / 20) * 4), count: 32)
        }
      }
      timeout = Task { [weak self] in
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled, let self, self.recognitionGeneration == generation else { return }
        self.finishCustomRecording()
      }
    } catch {
      stopListening()
      status = "Voice input could not start: \(error.localizedDescription)"
      voiceFailure = status
      NativeVerification.event("customSTTfailed", ["error": error.localizedDescription])
    }
  }

  /// Ends capture before transcription; only the current recording may publish its transcript.
  private func finishCustomRecording(removeRecording: Bool? = nil) {
    guard isListening, let url = customRecordingURL else { return }
    customRecorder?.stop()
    customRecorder = nil
    customRecordingURL = nil
    timeout?.cancel()
    timeout = nil
    customMeterTask?.cancel()
    customMeterTask = nil
    isListening = false
    microphoneMeter.levels = []
    #if os(iOS)
      if recordingSessionActive {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        recordingSessionActive = false
      }
    #endif
    let generation = recognitionGeneration
    let removeSource = removeRecording ?? ownsCustomRecording
    isTranscribing = true
    status = "Transcribing on this device…"
    customDecode = Task { [weak self] in
      guard let self else { return }
      defer {
        if removeSource { try? FileManager.default.removeItem(at: url) }
        if self.recognitionGeneration == generation {
          self.isTranscribing = false
          self.customDecode = nil
        }
      }
      do {
        let samples = try await Task.detached { try CustomSpeechSamples.read(url) }.value
        try Task.checkCancellation()
        NativeVerification.event(
          "customSTTstarted", ["samples": samples.count, "sampleRate": 16000])
        let text = try await CustomModelRuntime.shared.transcribe(samples: samples)
        try Task.checkCancellation()
        guard self.recognitionGeneration == generation, self.modelMode == .custom else { return }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
          throw CustomAudioFailure("No speech was recognized. Try recording again.")
        }
        NativeVerification.event("customSTTcompleted", ["transcript": text])
        self.receiveRecognizedText(text, isFinal: true)
      } catch {
        guard self.recognitionGeneration == generation else { return }
        self.status = "Speech could not finish: \(error.localizedDescription)"
        self.voiceFailure = self.status
        NativeVerification.event("customSTTfailed", ["error": error.localizedDescription])
      }
    }
  }

  /// Publishes partial text for display; only a successful final result runs a command.
  /// - Called after provider callbacks verify their current recording generation.
  /// - Clears decoder ownership before callbacks, so submitting cannot cancel its own speech task.
  /// - Empty, duplicate, stopped and stale results never submit mathematical work.
  func receiveRecognizedText(_ text: String, isFinal: Bool) {
    guard isListening || isTranscribing else { return }
    transcript = text
    guard isFinal else { return }
    let command = text.trimmingCharacters(in: .whitespacesAndNewlines)
    customDecode = nil
    isTranscribing = false
    stopListening()
    status = ""
    voiceFailure = nil
    guard !command.isEmpty else { return }
    transcript = command
    onRecognizedCommand?(command)
  }

  /// Ends microphone capture while retaining the Apple task until its final result.
  /// The five-second finalization deadline cancels an unresponsive task without running partial text.
  private func finishAppleRecording() {
    guard modelMode == .apple, isListening else { return }
    timeout?.cancel()
    endAppleCapture()
    isListening = false
    isTranscribing = true
    status = "Transcribing on this device…"
    microphoneMeter.levels = []
    let generation = recognitionGeneration
    timeout = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard !Task.isCancelled, let self, self.recognitionGeneration == generation else { return }
      self.stopListening()
      self.status = "Speech could not finish. Try again."
      self.voiceFailure = self.status
    }
  }

  /// Releases microphone resources without discarding an Apple recognition task's pending final result.
  private func endAppleCapture() {
    if engine?.isRunning == true { engine?.stop() }
    if hasTap {
      engine?.inputNode.removeTap(onBus: 0)
      hasTap = false
    }
    request?.endAudio()
    #if os(iOS)
      if recordingSessionActive {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        recordingSessionActive = false
      }
    #endif
  }

  func stopListening() {
    customDecode?.cancel()
    customDecode = nil
    customMeterTask?.cancel()
    customMeterTask = nil
    customRecorder?.stop()
    customRecorder = nil
    if ownsCustomRecording, let url = customRecordingURL {
      try? FileManager.default.removeItem(at: url)
    }
    customRecordingURL = nil
    isTranscribing = false
    CustomModelRuntime.shared.cancel()
    recognitionGeneration &+= 1
    isStarting = false
    timeout?.cancel()
    timeout = nil
    endAppleCapture()
    task?.cancel()
    task = nil
    request = nil
    isListening = false
    microphoneMeter.levels = []
  }
}

/// Describes recognition failures without exposing model paths or discarding a transcript.
enum SpeechFailureDescription {
  static func message(_ error: NSError, simulator: Bool) -> String {
    var cause = error
    for _ in 0..<6 {
      if cause.domain == "kLSRErrorDomain" && cause.code == 300 {
        return simulator
          ? "This simulator could not load Apple's English speech model. Check English speech setup, then try again."
          : "The English speech model could not load. Check English speech setup, then try again."
      }
      guard let underlying = cause.userInfo[NSUnderlyingErrorKey] as? NSError else { break }
      cause = underlying
    }
    return "Voice input stopped. Try again."
  }
}

private struct CustomAudioFailure: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// Converts a bounded recording to mono 16 kHz floating-point samples for custom speech.
/// - Streams the source through Apple's format converter; rejects clips longer than 30 seconds.
/// - Does not invoke speech recognition or alter the source recording.
enum CustomSpeechSamples {
  static func read(_ url: URL) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    guard format.sampleRate > 0, Double(file.length) / format.sampleRate <= 30.01,
      let target = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1),
      let converter = AVAudioConverter(from: format, to: target),
      let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192),
      let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 8192)
    else {
      throw CustomAudioFailure("Use a recording no longer than 30 seconds with a valid audio format.")
    }
    var samples: [Float] = []
    var sourceError: Error?
    var ended = false
    while !ended {
      var conversionError: NSError?
      let result = converter.convert(to: output, error: &conversionError) { needed, status in
        do {
          let remaining = file.length - file.framePosition
          guard remaining > 0 else { status.pointee = .endOfStream; return nil }
          let count = min(needed, input.frameCapacity, AVAudioFrameCount(remaining))
          try file.read(into: input, frameCount: count)
          if input.frameLength == 0 {
            status.pointee = .endOfStream
            return nil
          }
          status.pointee = .haveData
          return input
        } catch {
          sourceError = error
          status.pointee = .endOfStream
          return nil
        }
      }
      if let sourceError { throw sourceError }
      if let conversionError { throw conversionError }
      if let channel = output.floatChannelData?[0] {
        samples.append(
          contentsOf: UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
      }
      if samples.count > 16_000 * 30 {
        throw CustomAudioFailure("Recording exceeds the speech limit.")
      }
      switch result {
      case .endOfStream: ended = true
      case .error: throw CustomAudioFailure("Recording could not be converted for speech.")
      case .inputRanDry: ended = true
      case .haveData: break
      @unknown default: throw CustomAudioFailure("Unknown audio conversion result.")
      }
    }
    guard !samples.isEmpty, samples.allSatisfy({ $0.isFinite }) else {
      throw CustomAudioFailure("The recording contains no usable audio.")
    }
    return samples
  }
}

/// Writes optional verification evidence only inside the app container in DEBUG builds.
/// - Production builds have no environment-controlled file writes.
/// - Failure to write evidence is logged without modifying student work.
@MainActor
enum NativeVerification {
  /// Resolves fixture and evidence paths against the current app container.
  /// - Relative paths survive simulator app reinstalls; absolute paths must remain inside home.
  /// - Empty names, parent traversal and symbolic-link paths are rejected.
  nonisolated static func authorizedURL(_ value: String, home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> URL? {
    guard !value.isEmpty, !value.split(separator: "/").contains("..") else { return nil }
    let root = home.standardizedFileURL.resolvingSymlinksInPath()
    let candidate = value.hasPrefix("/")
      ? URL(fileURLWithPath: value)
      : root.appendingPathComponent(value)
    let url = candidate.standardizedFileURL.resolvingSymlinksInPath()
    guard url.path.hasPrefix(root.path + "/") else { return nil }
    // Resolve each existing parent separately: Foundation leaves an unresolved
    // parent link when the final output file does not exist yet.
    var parent = root
    let relative = String(url.path.dropFirst(root.path.count + 1))
    for component in relative.split(separator: "/") {
      parent.appendPathComponent(String(component))
      let attributes = try? FileManager.default.attributesOfItem(atPath: parent.path)
      if attributes?[.type] as? FileAttributeType == .typeSymbolicLink { return nil }
    }
    return url
  }

  static func path(_ key: String) -> URL? {
    #if DEBUG
      guard let value = ProcessInfo.processInfo.environment[key] else { return nil }
      return authorizedURL(value)
    #else
      return nil
    #endif
  }

  static func event(_ event: String, _ fields: [String: Any] = [:]) {
    CustomModelEvidence.record(event, details: fields)
  }
}

#if DEBUG
  /// Serializes synthesis callbacks into one real audio file; the zero-length buffer closes it.
  private final class VerificationSpeechWriter {
    private let lock = NSLock()
    private let path: URL
    private var file: AVAudioFile?
    private var finished = false
    init(path: URL) { self.path = path }
    func append(_ buffer: AVAudioBuffer) throws -> Bool {
      lock.lock()
      defer { lock.unlock() }
      guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return false }
      if pcm.frameLength == 0 {
        file = nil
        finished = true
        return true
      }
      if file == nil {
        try FileManager.default.createDirectory(
          at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        file = try AVAudioFile(forWriting: path, settings: pcm.format.settings)
      }
      try file?.write(from: pcm)
      return false
    }
  }
#endif
