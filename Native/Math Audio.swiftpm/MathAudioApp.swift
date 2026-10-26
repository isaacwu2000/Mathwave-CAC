import CoreText
import SwiftUI
import UniformTypeIdentifiers

#if canImport(MathAudioCore)
  import MathAudioCore
#endif

@main
struct MathAudioApp: App {
  @StateObject private var model = WorkbenchModel()
  init() { NativeTypography.register() }
  var body: some Scene {
    WindowGroup { WorkbenchView(model: model, audio: model.audio).font(NativeTypography.body) }
      #if os(macOS)
        .defaultSize(width: 1100, height: 820)
        .commands {
          CommandGroup(replacing: .newItem) {
            Button("New Problem") { model.perform("new") }.keyboardShortcut("n")
          }
          CommandGroup(after: .undoRedo) {
            Button("Undo Math Change") { model.perform("command", text: "undo") }.keyboardShortcut(
              "z", modifiers: [.command, .shift])
            Button("Redo Math Change") { model.perform("command", text: "redo") }.keyboardShortcut(
              "z", modifiers: [.command, .option])
          }
        }
      #endif
  }
}

/// Registers the same offline interface font used by the web worksheet.
/// SwiftUI custom fonts remain relative to text styles so Dynamic Type still applies.
enum NativeTypography {
  static func register() {
    #if SWIFT_PACKAGE
      let bundle = Bundle.module
    #else
      let bundle = Bundle.main
    #endif
    guard let folder = bundle.url(forResource: "Presentation", withExtension: nil) else { return }
    CTFontManagerRegisterFontsForURL(
      folder.appendingPathComponent("fonts/instrument-sans.ttf") as CFURL, .process, nil)
  }
  static let body = Font.custom("InstrumentSans-Regular", size: 17, relativeTo: .body)
  static let heading = Font.custom("InstrumentSans-Regular", size: 32, relativeTo: .largeTitle)
}

struct WorkspaceFile: FileDocument {
  static var readableContentTypes: [UTType] { [.json, .plainText, .pdf] }
  var data: Data
  init(_ text: String) { data = Data(text.utf8) }
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}

struct WorkbenchView: View {
  @ObservedObject var model: WorkbenchModel
  @ObservedObject var audio: AudioController
  @Environment(\.scenePhase) private var phase
  @Environment(\.dynamicTypeSize) private var typeSize
  @FocusState private var inputFocused: Bool
  @AccessibilityFocusState private var statusFocused: Bool

  @State private var composing = false
  @State private var structuredInput = true
  @State private var inspecting = false
  @State private var pendingPanel: String?
  @State private var showVisualControls = false
  @Environment(\.colorScheme) private var colorScheme

  // Legacy deterministic UI tests can seed work without exposing a command form to students.
  private var testCommandEntry: Bool {
    #if DEBUG
    return ProcessInfo.processInfo.environment["MATHWAVE_TEST_COMMAND_ENTRY"] == "1"
    #else
    return false
    #endif
  }

  private var peach: Color {
    colorScheme == .dark
      ? Color(red: 0.23, green: 0.15, blue: 0.12) : Color(red: 0.996, green: 0.949, blue: 0.925)
  }
  private let accent = Color(red: 0.827, green: 0.141, blue: 0.098)

  var body: some View {
    Group {
      if model.showSettings { SettingsView(model: model) } else { workspace }
    }.tint(accent)
  }

  private var workspace: some View {
    GeometryReader { space in
      let wide = space.size.width > 900
      let short = space.size.height < 500
      let empty = model.document.map { $0.steps.isEmpty && $0.explanation == nil } ?? true
      VStack(spacing: 0) {
        header(wide: wide, short: short, empty: empty)
        if let doc = model.document, !doc.steps.isEmpty || doc.explanation != nil {
          SharedPresentation(model: model, showControls: showVisualControls, fillsSpace: true)
            .padding(.horizontal, wide ? 32 : 12)
          worksheetActions(doc).padding(.vertical, 8)
        } else {
          ScrollView {
            VStack(spacing: 32) {
              Text("What math shall we play with today?")
                .font(NativeTypography.heading).fontWeight(.semibold)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
              voiceArea(short: short)

            }
            .frame(maxWidth: 720)
            .padding(.horizontal, 20).padding(.vertical, 32)
            .frame(maxWidth: .infinity, minHeight: max(0, space.size.height - 80))
          }
        }
        if model.storageBlocked {
          Button("Preserve unreadable file and start a new library") { model.recoverStorage() }
            .buttonStyle(.bordered).padding()
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.background)
    }
    .overlay(alignment: .top) {
      if let message = model.celebration {
        CompletionCelebration(message: message, enabled: model.celebrationActive).id(message)
          .allowsHitTesting(false)
      }
    }
    .tint(accent)
    .sheet(isPresented: $composing, onDismiss: presentPendingPanel) { composer }
    .sheet(
      isPresented: $inspecting,
      onDismiss: {
        model.showDetails = false
        presentPendingPanel()
      }
    ) {
      NavigationStack {
        ScrollView { if let doc = model.document { details(doc).padding(24) } }
          .navigationTitle("Explore work")
          .toolbar { Button("Done") { inspecting = false } }
      }
    }
    .sheet(isPresented: $model.showLibrary) { library }
    .onChange(of: model.draft) { _ in
      if !model.isRunningCustom { model.scheduleDraftSave() }
    }
    .onChange(of: model.message) { _ in statusFocused = true }
    .onChange(of: model.document?.problemId) { _ in showVisualControls = false }
    .onChange(of: model.document?.mode) { _ in showVisualControls = false }
    .onChange(of: model.showDetails) { value in if value && !composing { inspecting = true } }
    .onChange(of: model.focusRequest) { _ in
      if testCommandEntry { composing = true }
      else { Task { await audio.toggleListening() } }
    }
    .onChange(of: phase) { value in
      if value != .active { model.flushDraft() }
      if value == .background {
        model.cancelCustomRun()
        audio.stopListening()
        audio.stopSpeaking()
      }
    }
    .onDisappear {
      model.cancelCustomRun()
      model.flushDraft()
      audio.stopListening()
      audio.stopSpeaking()
    }
  }

  private func header(wide: Bool, short: Bool, empty: Bool) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack(alignment: .top, spacing: 20) {
        Button {
          model.showSettings = true
        } label: {
          Image(systemName: "person.crop.circle").font(.title2).frame(width: 48, height: 48)
        }.accessibilityLabel("Settings")
        Button {
          model.cancelCustomRun()
          audio.stopListening()
          audio.stopSpeaking()
        } label: {
          Image(systemName: "stop.fill").frame(width: 44, height: 44)
        }.accessibilityLabel("Stop audio").keyboardShortcut(.escape, modifiers: [])
        if (wide || short) && !empty {
          Spacer()
          voiceArea(short: short).frame(maxWidth: 580)
        } else {
          Spacer()
          Menu {
            if testCommandEntry { Button("Enter a command") { composing = true } }
            Button("New problem") { model.perform("new") }
          } label: {
            Image(systemName: "ellipsis").frame(width: 44, height: 44)
          }.accessibilityLabel("Workspace options")
        }
      }
      if !wide && !short && !empty { voiceArea(short: short) }
    }
    .foregroundStyle(.primary)
    .padding(.horizontal, wide ? 32 : 16).padding(.top, 12)
  }

  private func voiceArea(short: Bool) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Button {
          Task {
            model.cancelCustomRun()
            await audio.toggleListening()
          }
        } label: {
          HStack(spacing: 16) {
            Image(systemName: audio.isListening ? "stop.fill" : "mic").font(.title2)
            VStack(alignment: .leading, spacing: 7) {
              Text(
                audio.isStarting
                  ? "Starting microphone…"
                  : audio.isListening
                    ? (audio.transcript.isEmpty ? "Listening…" : audio.transcript) : ""
              )
              .font(NativeTypography.body).lineLimit(typeSize.isAccessibilitySize ? nil : 2)
              .fixedSize(horizontal: false, vertical: true).frame(minHeight: 22)
              MicrophoneWaveform(meter: audio.microphoneMeter, listening: audio.isListening)
            }.frame(maxWidth: .infinity)
          }
          .padding(16).frame(minHeight: 76)
          .foregroundStyle(audio.isListening ? Color.white : Color.primary)
          .background(
            audio.isListening ? accent : Color.controlBackground,
            in: RoundedRectangle(cornerRadius: 16)
          )
          .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 4)
        }.buttonStyle(.plain)
          .disabled(audio.isPreparingVoice)
          .accessibilityLabel(
            audio.isStarting
              ? "Cancel startup" : audio.isListening ? "Stop recording"
                : audio.isTranscribing ? "Cancel transcription" : "Voice input"
          )
          .accessibilityHint("Speak your request, then stop recording to apply it.")
        VoiceArrow(active: audio.isListening || audio.isSpeaking || model.picoActivity.working).foregroundStyle(.secondary).frame(
          width: 32, height: 24
        ).accessibilityHidden(
          true)
        VStack(spacing: 4) {
          PicoMark(activity: model.picoActivity).frame(width: 48, height: 56)
          if let progress = model.picoActivity.progress {
            Text(progress).font(.caption).foregroundStyle(.secondary)
              .fixedSize().accessibilityIdentifier("pico.progress")
          }
        }.frame(width: 72)
      }
      response
    }
  }

  /// Keep automatic drawing descriptions in readback; explicit results remain visible.
  private var quietDrawingDescription: Bool {
    guard !showVisualControls, let doc = model.document else { return false }
    return (doc.mode == "geometry" || !doc.graphRows.isEmpty)
      && (model.message == doc.description || model.message.hasPrefix("Sampled graph of"))
  }

  private var response: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(
        model.picoActivity.working ? ""
          : audio.isListening || audio.isStarting || audio.voiceFailure != nil || audio.isPreparingVoice
          ? audio.status
          : model.message == "Your work stays on this device." || quietDrawingDescription
            ? "" : model.message
      )
      .font(NativeTypography.body).foregroundStyle(
        audio.voiceFailure == nil ? Color.secondary : Color.primary
      ).frame(
        maxWidth: .infinity, alignment: .center
      )
      .multilineTextAlignment(.center)
      .accessibilityLabel(
        model.picoActivity.progress ?? (
          audio.isListening || audio.isStarting || audio.voiceFailure != nil || audio.isPreparingVoice
            ? audio.status : model.message)
      )
      .accessibilityFocused($statusFocused).accessibilityIdentifier("workspace.status")
      if audio.voiceFailure != nil {
        if model.localModelMode == .custom {
          Button("Use Apple models") { model.localModelMode = .apple }.frame(minHeight: 44)
        } else {
          Button("Set up English speech") { Task { await audio.prepareEnglishSpeech() } }
            .disabled(audio.isPreparingVoice).frame(minHeight: 44)
        }
        if testCommandEntry { Button("Enter a command") { composing = true }.frame(minHeight: 44) }
      }
      if !audio.transcript.isEmpty && !audio.isListening {
        Text(audio.transcript).font(NativeTypography.body).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .center)
          .multilineTextAlignment(.center).accessibilityIdentifier("voice.transcript")
      }
      if !audio.isListening && !model.picoActivity.working && audio.voiceFailure == nil && !audio.isPreparingVoice
        && audio.status != ""
        && audio.status != "Voice is optional. Everything also works with a keyboard."
      {
        Text(audio.status).font(.caption).foregroundStyle(.secondary)
      }

    }
  }

  private func worksheetActions(_ doc: WorkbenchDocument) -> some View {
    HStack(spacing: 12) {
      Menu {
        if testCommandEntry { Button("Enter a command") { composing = true } }
        Button("New problem") { model.perform("new") }
      } label: {
        Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
      }.accessibilityLabel("Command options")
      Button {
        model.perform("command", text: "undo")
      } label: {
        Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44)
      }
      .accessibilityLabel("Undo").disabled(!doc.canUndo)
      Button {
        model.perform("command", text: "redo")
      } label: {
        Image(systemName: "arrow.uturn.forward").frame(width: 44, height: 44)
      }
      .accessibilityLabel("Redo").disabled(!doc.canRedo)

      if doc.mode == "geometry" || !doc.graphRows.isEmpty {
        Menu {
          Button(showVisualControls ? "Show drawing only" : "Edit drawing") {
            showVisualControls.toggle()
          }
          Button("Read work") { audio.speak(doc.description) }
          if !doc.graphRows.isEmpty {
            Button("Fit curves") { model.perform("command", text: "fit graph") }
            Button("Read points") { model.perform("command", text: "table") }
            Button("Play graph") { model.perform("command", text: "play graph") }
          }
          Button("Explore parts") { inspecting = true }
        } label: {
          Image(systemName: "ellipsis").frame(width: 44, height: 44)
        }.accessibilityLabel("Explore work")
      } else {
        Button {
          inspecting = true
        } label: {
          Image(systemName: "ellipsis").frame(width: 44, height: 44)
        }.accessibilityLabel("Explore work")
      }
    }.foregroundStyle(.secondary)
  }

  private var composer: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if structuredInput {
            SharedPresentation(model: model, composing: true)
          } else {
            TextField("Type math or a command", text: $model.draft, axis: .vertical)
              .textFieldStyle(.roundedBorder).lineLimit(2...6).font(.title3)
              .focused($inputFocused).accessibilityLabel("Math or command input")
              .accessibilityIdentifier("command.input")
          }
          Button(structuredInput ? "Use plain text" : "Use math keyboard") {
            structuredInput.toggle()
          }
          Text("Review your command before running it.").font(.callout).foregroundStyle(.secondary)
          Button("Run command") {
            inputFocused = false
            model.submit()
            if model.draft.isEmpty {
              // Present command-requested panels only after the command sheet is dismissed.
              pendingPanel =
                model.showDetails
                ? "details" : model.showSettings ? "settings" : model.showLibrary ? "library" : nil
              model.showDetails = false
              model.showSettings = false
              model.showLibrary = false
              composing = false
            }
          }.buttonStyle(.borderedProminent).controlSize(.large).disabled(
            model.storageBlocked || model.isRunningCustom || audio.isTranscribing)
          Text(model.message).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier(
            "command.status")
          Spacer()
        }.padding(24)
      }.navigationTitle("Math command")
        .toolbar { Button("Done") { composing = false } }
    }
    .onAppear { inputFocused = !structuredInput }
    .onChange(of: structuredInput) { value in inputFocused = !value }
    #if os(macOS)
      .frame(minWidth: 520, minHeight: 360)
    #endif
  }

  private func details(_ doc: WorkbenchDocument) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      Text(doc.description).font(.title3).textSelection(.enabled)
      Button("Read work") { audio.speak(doc.description) }.frame(minHeight: 44)
      Button("Stop audio") {
        audio.stopListening()
        audio.stopSpeaking()
      }.frame(minHeight: 44)
      if doc.plot != nil {
        Button("Fit curves") { model.perform("command", text: "fit graph") }.frame(minHeight: 44)
        Button("Read points") { model.perform("command", text: "table") }.frame(minHeight: 44)
        Button("Play graph") { model.perform("command", text: "play graph") }.frame(minHeight: 44)
      }
      if doc.mode == "statistics" {
        DataValuesView(values: doc.data)
        Button("Play data") { model.perform("command", text: "play data") }.frame(minHeight: 44)
      }
      DisclosureGroup("Explore parts") {
        ForEach(Array(doc.parts.enumerated()), id: \.element.id) { index, part in
          HStack {
            Text(part.spoken).frame(maxWidth: .infinity, alignment: .leading)
            Button {
              audio.speak(part.spoken)
            } label: {
              Image(systemName: "speaker.wave.2").frame(width: 44, height: 44)
            }.accessibilityLabel("Read \(part.label)")
            Button("Select") { model.perform("command", text: "select part \(index + 1)") }.frame(
              minHeight: 44)
          }
        }
      }
    }
  }

  /// A sheet must finish dismissing before another panel can take its place.
  private func presentPendingPanel() {
    let panel = pendingPanel
    pendingPanel = nil
    switch panel {
    case "details": inspecting = true
    case "settings": model.showSettings = true
    case "library": model.showLibrary = true
    default: break
    }
  }

  private var library: some View {
    NavigationStack {
      List(model.document?.problems ?? []) { problem in
        Button(problem.title) {
          model.perform("select", text: problem.id)
          model.showLibrary = false
        }.frame(minHeight: 44)
      }.navigationTitle("Saved problems").toolbar { Button("Done") { model.showLibrary = false } }
    }
  }

}

extension Color {
  static var background: Color {
    #if os(iOS)
      Color(uiColor: .systemBackground)
    #else
      Color(nsColor: .windowBackgroundColor)
    #endif
  }
  fileprivate static var controlBackground: Color {
    #if os(iOS)
      Color(uiColor: .secondarySystemGroupedBackground)
    #else
      Color(nsColor: .controlBackgroundColor)
    #endif
  }
}

/// Mirrors desktop Pico's independent listening, working and audible-playback cues.
private struct PicoMark: View {
  let activity: PicoActivity
  @Environment(\.accessibilityReduceMotion) private var reducedMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var workingSince = Date()

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30,
      paused: reducedMotion || scenePhase != .active || !(activity.working || activity.speaking))) { timeline in
      let moving = !reducedMotion && scenePhase == .active
      let time = moving ? timeline.date.timeIntervalSinceReferenceDate : 0
      let consideration = activity.working && moving
        ? sin(min(1, max(0, timeline.date.timeIntervalSince(workingSince) / 0.9)) * .pi) : 0
      mark(time: time, consideration: consideration)
        .scaleEffect(x: activity.speaking ? 1 + sin(time * 4) * 0.008 : 1,
          y: activity.speaking ? 1 + sin(time * 4) * 0.01 : 1, anchor: .bottom)
        .rotationEffect(.degrees(activity.attention == .clarifying ? 5 : activity.listening ? -4 : 0), anchor: .bottom)
    }
    .onChange(of: activity.working) { if $0 { workingSince = Date() } }
    .accessibilityElement(children: .ignore).accessibilityLabel(activity.label)
    .accessibilityIdentifier("pico.activity")
  }

  private func mark(time: Double, consideration: Double) -> some View {
    Canvas { context, size in
      let transform = CGAffineTransform(scaleX: size.height / 136, y: size.height / 136)
      for (width, height, opacity) in [(74.0, 8.0, 0.055), (54.0, 5.0, 0.07)] {
        let shadow = Path(ellipseIn: CGRect(x: 60 - width / 2, y: 126 - height / 2,
          width: width, height: height)).applying(transform)
        context.fill(shadow, with: .color(Color(red: 0.77, green: 0.65, blue: 0.56).opacity(opacity)))
      }
      var body = Path()
      body.move(to: CGPoint(x: 48, y: 17))
      body.addCurve(to: CGPoint(x: 72, y: 17), control1: CGPoint(x: 54, y: 5), control2: CGPoint(x: 65, y: 5))
      body.addLine(to: CGPoint(x: 110, y: 92))
      body.addCurve(to: CGPoint(x: 94, y: 119), control1: CGPoint(x: 119, y: 110), control2: CGPoint(x: 111, y: 119))
      body.addLine(to: CGPoint(x: 26, y: 119))
      body.addCurve(to: CGPoint(x: 10, y: 92), control1: CGPoint(x: 8, y: 119), control2: CGPoint(x: 1, y: 110))
      body.closeSubpath()
      let silhouette = body.applying(transform)
      context.fill(silhouette, with: .linearGradient(
        Gradient(colors: [Color(red: 0.976, green: 0.788, blue: 0.659), Color(red: 0.918, green: 0.663, blue: 0.502)]),
        startPoint: .zero, endPoint: CGPoint(x: size.width * 0.75, y: size.height)))
      context.fill(silhouette, with: .radialGradient(
        Gradient(colors: [Color(red: 1, green: 0.94, blue: 0.84).opacity(0.62), .clear]),
        center: CGPoint(x: size.width * 0.42, y: size.height * 0.24),
        startRadius: 0, endRadius: size.height * 0.8))
      for (index, x) in [35.0, 69.0].enumerated() {
        let gaze = activity.listening ? -3.0 : 0
        let attentionX = activity.attention == .clarifying ? (index == 0 ? -2.0 : 2.0) : 0
        let attentionY = activity.attention == .clarifying ? -2.0 : activity.attention == .unavailable ? 3.0 : 0
        let eye = CGRect(x: x + gaze + attentionX + consideration * (index == 0 ? 1 : 3),
          y: 62 + attentionY + consideration * (index == 0 ? -3 : 1), width: 16, height: 16)
        context.fill(Path(ellipseIn: eye).applying(transform), with: .color(Color(red: 0.16, green: 0.15, blue: 0.14)))
      }
      if activity.speaking {
        for index in 0..<3 {
          let x = 121.0 + Double(index) * 9
          let spread = 14.0 + Double(index) * 7
          var wave = Path()
          wave.move(to: CGPoint(x: x, y: 67 - spread))
          wave.addQuadCurve(to: CGPoint(x: x, y: 67 + spread), control: CGPoint(x: x + 22 + Double(index) * 7, y: 67))
          let opacity = reducedMotion || scenePhase != .active ? 0.7 : 0.15 + 0.65 * (0.5 + 0.5 * sin(time * 7 - Double(index) * 0.84))
          context.stroke(wave.applying(transform), with: .color(Color(red: 0.61, green: 0.35, blue: 0.20).opacity(opacity)),
            style: StrokeStyle(lineWidth: 1, lineCap: .round))
        }
      }
    }
    // The desktop speech waves extend beyond Pico's body; Canvas needs real room to draw them.
    .frame(width: 68, height: 56).frame(width: 48, height: 56, alignment: .leading)
  }
}

private struct MicrophoneWaveform: View {
  @ObservedObject var meter: MicrophoneMeter
  let listening: Bool
  var body: some View {
    Canvas { context, size in
      if listening && !meter.levels.isEmpty {
        for (index, level) in meter.levels.enumerated() {
          let x = size.width * (CGFloat(index) + 0.5) / CGFloat(meter.levels.count)
          let amplitude = max(1, CGFloat(level) * size.height / 2)
          var bar = Path()
          bar.move(to: CGPoint(x: x, y: size.height / 2 - amplitude))
          bar.addLine(to: CGPoint(x: x, y: size.height / 2 + amplitude))
          context.stroke(bar, with: .foreground, style: StrokeStyle(lineWidth: 2, lineCap: .round))
        }
      } else {
        var line = Path()
        line.move(to: CGPoint(x: 0, y: size.height / 2))
        line.addLine(to: CGPoint(x: size.width, y: size.height / 2))
        context.stroke(
          line, with: .foreground,
          style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [1, 5]))
      }
    }.frame(height: listening ? 32 : 12).opacity(0.55).accessibilityHidden(true)
  }
}

private struct VoiceArrow: View {
  let active: Bool
  @Environment(\.accessibilityReduceMotion) private var reducedMotion
  var body: some View {
    if active && !reducedMotion {
      TimelineView(.animation(minimumInterval: 0.1)) { timeline in
        arrow(
          phase: -timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1)
            * 18)
      }
    } else {
      arrow(phase: 0)
    }
  }
  private func arrow(phase: Double) -> some View {
    Canvas { context, size in
      var line = Path()
      line.move(to: CGPoint(x: 0, y: size.height / 2))
      line.addLine(to: CGPoint(x: size.width - 6, y: size.height / 2))
      context.stroke(
        line, with: .foreground,
        style: StrokeStyle(lineWidth: 1.5, dash: [5, 4], dashPhase: phase))
      var tip = Path()
      tip.move(to: CGPoint(x: size.width - 7, y: size.height / 2 - 5))
      tip.addLine(to: CGPoint(x: size.width, y: size.height / 2))
      tip.addLine(to: CGPoint(x: size.width - 7, y: size.height / 2 + 5))
      tip.closeSubpath()
      context.stroke(tip, with: .foreground, lineWidth: 1.5)
    }
  }
}

/// A silent, short burst never takes focus or intercepts worksheet controls.
private struct CompletionCelebration: View {
  let message: String
  let enabled: Bool
  @Environment(\.accessibilityReduceMotion) private var reducedMotion
  @State private var started = Date()
  @State private var animating = true
  var body: some View {
    ZStack(alignment: .top) {
      if enabled && !reducedMotion && animating {
        TimelineView(.animation) { timeline in
          Canvas { context, size in
            let elapsed = timeline.date.timeIntervalSince(started)
            for index in 0..<48 {
              let travel = elapsed / 2.2
              let horizontal = Double((index * 37) % 100) / 100
              let x = size.width * (0.5 + (horizontal - 0.5) * min(1, travel * 3))
              let y = size.height * travel * (0.4 + Double(index % 7) / 12)
              var particle = context
              particle.opacity = max(0, 1 - travel)
              particle.translateBy(x: x, y: y)
              particle.rotate(by: .degrees(Double(index * 19) + elapsed * 100))
              particle.fill(
                Path(CGRect(x: -3, y: -5, width: 6, height: 10)),
                with: .color(
                  index.isMultiple(of: 2)
                    ? Color(red: 0.83, green: 0.14, blue: 0.1)
                    : Color(red: 0.96, green: 0.74, blue: 0.60)))
            }
          }
        }.accessibilityHidden(true)
      }
      Text(message).font(.headline).padding(16).background(Color.background)
        .accessibilityIdentifier("workspace.completion")
    }
    .task {
      try? await Task.sleep(nanoseconds: 2_200_000_000)
      animating = false
    }
  }
}
