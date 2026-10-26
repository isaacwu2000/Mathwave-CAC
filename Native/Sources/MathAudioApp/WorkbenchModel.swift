import SwiftUI

#if canImport(MathAudioCore)
  import MathAudioCore
#endif

/// Keeps request progress independent from listening and actual spoken playback.
struct PicoActivity {
  enum Attention { case neutral, clarifying, unavailable }
  let listening: Bool
  let working: Bool
  let speaking: Bool
  let attention: Attention
  var progress: String? { working ? "Working…" : nil }
  var label: String {
    let activity = [
      listening ? "listening" : nil, working ? "working" : nil, speaking ? "speaking" : nil,
      attention == .clarifying ? "waiting for clarification" : nil,
      attention == .unavailable ? "ready to retry" : nil,
    ].compactMap { $0 }.joined(separator: ", ")
    return "Pico: " + (activity.isEmpty ? "ready" : activity)
  }
}

@MainActor
final class WorkbenchModel: ObservableObject {
  @Published private(set) var document: WorkbenchDocument?
  @Published var draft = ""
  @Published var message = "Loading your saved work…"
  @Published var revisionDrafts: [String: String] = [:] {
    didSet { preferences.set(revisionDrafts, forKey: "native.revisionDrafts") }
  }
  @Published var showDetails = false
  @Published var showSettings = false
  @Published var showLibrary = false
  @Published var readAutomatically = false {
    didSet { preferences.set(readAutomatically, forKey: "native.readAutomatically") }
  }
  @Published var localModelMode: LocalModelMode = .apple {
    didSet {
      cancelCustomRun()
      preferences.set(localModelMode.rawValue, forKey: "native.localModelMode")
      audio.selectModelMode(localModelMode)
    }
  }
  @Published var celebrationsEnabled = true {
    didSet {
      preferences.set(celebrationsEnabled, forKey: "native.celebrations")
      celebration = nil
    }
  }
  @Published var celebration: String?
  @Published private(set) var celebrationActive = false
  @Published var saveFailed = false
  @Published var storageBlocked = false
  @Published var requestedExport: String?
  @Published var focusRequest = 0
  let audio = AudioController()
  private var engine: SharedWorkbench?
  private let preferences: UserDefaults
  private let libraryStore: SQLiteLibraryStore
  let exportFilename: String
  private var draftSave: Task<Void, Never>?
  @Published private(set) var isRunningCustom = false
  private var customRun: Task<Void, Never>?
  private var customGeneration: UInt = 0
  private var clarificationJSON: String?
  @Published private var commandFailed = false
  private let customInterpreter: (@MainActor (String) async throws -> String)?

  var customModelStatus: String { CustomModelRuntime.installationStatus }

  var picoActivity: PicoActivity {
    let working = isRunningCustom || audio.isTranscribing
    let attention: PicoActivity.Attention = working || audio.isListening ? .neutral
      : audio.voiceFailure != nil || commandFailed || storageBlocked ? .unavailable
      : clarificationJSON != nil ? .clarifying : .neutral
    return PicoActivity(listening: audio.isListening, working: working,
      speaking: audio.isSpeaking, attention: attention)
  }

  /// Opens an isolated or student library and restores local preferences.
  /// - New preferences choose installed custom models, otherwise Apple; saved choices take priority.
  /// - Optional inference injection is used only by custom mode; normal runs use bundled models.
  /// - Unreadable storage stays untouched and blocks writes until explicit recovery.
  init(
    storageURL: URL? = nil, preferences: UserDefaults? = nil,
    customModelsInstalled: Bool = CustomModelRuntime.isInstalled,
    customInterpreter: (@MainActor (String) async throws -> String)? = nil
  ) {
    self.customInterpreter = customInterpreter
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    #if DEBUG
      let testID = ProcessInfo.processInfo.environment["MATH_AUDIO_UI_TEST_ID"]
      exportFilename = testID.map { "Mathwave-test-" + $0 } ?? "Mathwave-work"
      let defaultURL =
        testID.map {
          base.appendingPathComponent("MathAudioUITests", isDirectory: true).appendingPathComponent(
            $0 + ".sqlite")
        }
        ?? base.appendingPathComponent("MathAudio", isDirectory: true).appendingPathComponent(
          "problems.sqlite")
    #else
      let testID: String? = nil
      exportFilename = "Mathwave-work"
      let defaultURL = base.appendingPathComponent("MathAudio", isDirectory: true)
        .appendingPathComponent("problems.sqlite")
    #endif
    libraryStore = SQLiteLibraryStore(url: storageURL ?? defaultURL)
    self.preferences =
      preferences ?? testID.flatMap { UserDefaults(suiteName: "MathwaveUITests." + $0) }
      ?? .standard
    revisionDrafts =
      self.preferences.dictionary(forKey: "native.revisionDrafts") as? [String: String] ?? [:]
    readAutomatically = self.preferences.bool(forKey: "native.readAutomatically")
    localModelMode =
      LocalModelMode(rawValue: self.preferences.string(forKey: "native.localModelMode") ?? "")
      ?? (customModelsInstalled ? .custom : .apple)
    #if DEBUG
      if ProcessInfo.processInfo.environment["MATHWAVE_VERIFICATION_MODEL_MODE"] == "custom" {
        localModelMode = .custom
      }
    #endif
    audio.selectModelMode(localModelMode)
    celebrationsEnabled = self.preferences.object(forKey: "native.celebrations") as? Bool ?? true
    do {
      let engine = try SharedWorkbench()
      self.engine = engine
      let raw = try libraryStore.load()
      let opened = try engine.perform("open", library: raw)
      if !libraryStore.exists { try libraryStore.save(opened.library) }
      document = opened
      draft = opened.draft
      message = "Your work stays on this device."
    } catch {
      storageBlocked = true
      message =
        "Could not open saved work: \(error.localizedDescription) The original file has been preserved."
    }
    audio.onRecognizedCommand = { [weak self] text in self?.acceptVoiceCommand(text) }
  }

  /// Saves a complete validated library atomically before displaying success.
  /// Failed saves retain the previous document and the student's current draft.
  @discardableResult
  func perform(_ operation: String, text: String = "", index: Double = 0) -> Bool {
    audio.stopListening()
    cancelCustomRun()
    clarificationJSON = nil
    guard let engine, !storageBlocked else { return false }
    celebration = nil
    celebrationActive = false
    draftSave?.cancel()
    do {
      let previousMessage = message
      let savedDraft = try engine.perform("draft", library: document?.library, text: draft)
      try persist(savedDraft.library)
      document = savedDraft
      let next = try engine.perform(
        operation, library: savedDraft.library, text: text, index: index)
      try persist(next.library)
      if document?.problemId != next.problemId {
        audio.stopSpeaking()
        audio.transcript = ""
      }
      document = next
      draft = next.draft
      message = next.message
      publishActions(next, previousMessage: previousMessage, operation: operation, text: text)
      return true
    } catch {
      commandFailed = true
      message = "\(error.localizedDescription) Your saved work is unchanged."
      return false
    }
  }

  /// Runs a finalized spoken command through the same submission path as the worksheet.
  /// - Empty recognition never changes saved work; partial text never enters this method.
  /// - Clears stale voice status and needs no composer, keyboard or manual Run action.
  func acceptVoiceCommand(_ text: String) {
    let command = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !command.isEmpty else { return }
    audio.status = ""
    draftSave?.cancel()
    draft = command
    NativeVerification.event("voiceCommandAccepted", ["transcript": command, "source": "audio"])
    submit()
  }

  /// Runs custom inference against a frozen draft and library, then saves once.
  /// - Any edit, provider change, cancellation or concurrent library change discards the proposal.
  /// - Validation and mathematical execution use the shared web harness; errors keep saved work.
  func submit() {
    audio.stopListening()
    guard localModelMode == .custom else {
      perform("submit", text: draft)
      return
    }
    cancelCustomRun()
    guard let engine, !storageBlocked else { return }
    guard customInterpreter != nil || CustomModelRuntime.isInstalled else {
      commandFailed = true
      message = CustomModelRuntime.installationStatus
      return
    }
    draftSave?.cancel()
    let submitted = draft
    let originalLibrary = document?.library
    let generation = customGeneration
    let previousMessage = message
    let priorClarification = clarificationJSON
    isRunningCustom = true
    message = "Working…"
    customRun = Task { [weak self] in
      guard let self else { return }
      defer {
        if self.customGeneration == generation {
          self.isRunningCustom = false
          self.customRun = nil
        }
      }
      do {
        let prepared = try engine.perform("draft", library: originalLibrary, text: submitted)
        NativeVerification.event("customRunStarted", ["request": submitted])
        let outcome = try await engine.runAgent(
          submitted, library: prepared.library,
          clarificationJSON: priorClarification
        ) { request in
          try Task.checkCancellation()
          NativeVerification.event("customLLMstarted", ["requestBytes": request.utf8.count])
          let response: String
          if let infer = self.customInterpreter {
            response = try await infer(request)
          } else {
            response = try await CustomModelRuntime.shared.interpret(request)
          }
          try Task.checkCancellation()
          NativeVerification.event("customLLMcompleted", ["responseJSON": response])
          return response
        }
        try Task.checkCancellation()
        guard generation == self.customGeneration, self.localModelMode == .custom,
          self.draft == submitted, self.document?.library == originalLibrary
        else { return }
        try self.persist(outcome.document.library)
        self.document = outcome.document
        self.draft = outcome.document.draft
        self.message = outcome.document.message
        self.clarificationJSON = outcome.clarificationJSON
        self.commandFailed = outcome.status == "unsupported"
        self.publishActions(
          outcome.document, previousMessage: previousMessage,
          operation: "submit", text: submitted)
        NativeVerification.event(
          "customRunCompleted",
          [
            "expression": outcome.document.expression,
            "message": outcome.document.message,
          ])
      } catch {
        guard generation == self.customGeneration else { return }
        self.commandFailed = !(error is CancellationError)
        self.message =
          error is CancellationError
          ? "Stopped. Your saved work is unchanged."
          : "\(error.localizedDescription) Your saved work is unchanged."
        NativeVerification.event("customRunFailed", ["error": error.localizedDescription])
      }
    }
  }

  /// Cancels pending model work before any operation can replace the current worksheet.
  func cancelCustomRun() {
    if isRunningCustom { message = "Stopped." }
    customGeneration &+= 1
    customRun?.cancel()
    customRun = nil
    isRunningCustom = false
    commandFailed = false
    CustomModelRuntime.shared.cancel()
  }

  /// Applies native controls and spoken feedback only after the complete library has saved.
  private func publishActions(
    _ next: WorkbenchDocument, previousMessage: String,
    operation: String, text: String
  ) {
    if let answer = next.completion {
      let receipt = "native.completion.\(next.problemId).\(answer)"
      if !preferences.bool(forKey: receipt) {
        preferences.set(true, forKey: receipt)
        celebration = "Solution checked: \(answer)"
        celebrationActive = celebrationsEnabled
      }
    }
    switch next.action {
    case "calculations": showDetails = true
    case "help": message = "Speak a problem to Pico to begin."
    case "close-help":
      showDetails = false
      showSettings = false
      showLibrary = false
    case "export", "print":
      requestedExport = next.action
      showSettings = true
    case "settings": showSettings = true
    case "library": showSettings = true
    case "stop", "listen-stop":
      audio.stopListening()
      audio.stopSpeaking()
    case "mute": readAutomatically = false
    case "unmute": readAutomatically = true
    case "repeat":
      message = previousMessage
      audio.speak(previousMessage)
    case "focus": focusRequest += 1
    case "sonify": audio.sonify(next.audio)
    case "slower": audio.speechRate = max(0.2, audio.speechRate - 0.05)
    case "faster": audio.speechRate = min(0.65, audio.speechRate + 0.05)
    default:
      if operation == "command" || operation == "submit",
        readAutomatically || text.lowercased().hasPrefix("read")
      {
        audio.speak(message)
      }
    }
  }

  /// Debounces editable drafts; cancellation never submits a mathematical command.
  func scheduleDraftSave() {
    if isRunningCustom { cancelCustomRun() }
    draftSave?.cancel()
    guard !storageBlocked else { return }
    draftSave = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 350_000_000)
      guard !Task.isCancelled, let self else { return }
      self.flushDraft()
    }
  }

  func flushDraft() {
    if isRunningCustom { cancelCustomRun() }
    draftSave?.cancel()
    guard let engine, !storageBlocked else { return }
    do {
      let next = try engine.perform("draft", library: document?.library, text: draft)
      try persist(next.library)
      document = next
    } catch {
      saveFailed = true
      message =
        "Draft could not save: \(error.localizedDescription) Keep this window open and export your work."
    }
  }

  /// Returns a backup including the current draft even when saving to disk fails.
  /// Unreadable libraries are exported verbatim so recovery never destroys the original.
  func backupForExport() throws -> String {
    if storageBlocked {
      do { return try libraryStore.originalText() }
      catch { return try libraryStore.unreadableArchive() }
    }
    guard let engine else { throw WorkbenchFailure("The local math engine is unavailable.") }
    return try engine.perform("draft", library: document?.library, text: draft).library
  }

  /// Exports one problem without switching the worksheet, or all problems with their drafts.
  /// A failed local write does not prevent downloading the in-memory work.
  func textForExport(problemID: String? = nil, allProblems: Bool = false) throws -> String {
    guard let engine, !storageBlocked else {
      throw WorkbenchFailure("Download the original backup before recovering unreadable work.")
    }
    let latest = try engine.perform("draft", library: document?.library, text: draft)
    if allProblems { return latest.libraryText }
    if let problemID {
      return try engine.perform("export-problem", library: latest.library, text: problemID)
        .exportText
    }
    return latest.exportText
  }

  /// Archives unreadable work before starting a new library, only after an explicit recovery action.
  func recoverStorage() {
    audio.stopListening()
    cancelCustomRun()
    do {
      let engine = try SharedWorkbench()
      let next = try engine.perform("open")
      try libraryStore.recover(with: next.library) { raw in
        _ = try engine.perform("open", library: raw)
      }
      saveFailed = false
      self.engine = engine
      if document?.problemId != next.problemId {
        audio.stopSpeaking()
        audio.transcript = ""
      }
      document = next
      draft = next.draft
      storageBlocked = false
      message = "Started a new library. The unreadable original is preserved beside it."
    } catch { message = "Recovery could not finish: \(error.localizedDescription)" }
  }

  private func persist(_ library: String) throws {
    do {
      try libraryStore.save(library)
      saveFailed = false
    } catch {
      saveFailed = true
      throw error
    }
  }
}
