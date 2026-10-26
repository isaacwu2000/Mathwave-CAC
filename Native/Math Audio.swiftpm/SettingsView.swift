import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
  import UIKit
#endif

#if canImport(MathAudioCore)
  import MathAudioCore
#endif

/// Native controls follow the web Settings hierarchy; wide windows show two columns.
struct SettingsView: View {
  @ObservedObject var model: WorkbenchModel
  @State private var visible = 5
  @State private var searchOpen = false
  @State private var query = ""
  @State private var sort = "recent"
  @State private var deleting: SavedProblem?
  @State private var deleteError = ""
  @State private var renaming = false
  @State private var name = ""
  @State private var importing = false
  @State private var exporting = false
  @State private var exportFile = WorkspaceFile("")
  @State private var exportType = UTType.json
  @State private var filename = "Mathwave-work"
  @State private var fileStatus = ""
  @State private var preparingPDF = false
  @State private var exportURL: URL?
  @State private var preparedExport: PreparedExport?
  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(\.colorScheme) private var colorScheme
  private let secondaryInk = Color.primary.opacity(0.72)
  private var settingsTint: Color {
    colorScheme == .dark ? .red : Color(red: 0.827, green: 0.141, blue: 0.098)
  }

  private var exportBusy: Bool { preparingPDF || exporting }
  private var problems: [SavedProblem] { model.document?.problems ?? [] }
  private var recent: [SavedProblem] { problems.sorted { $0.at > $1.at } }
  private var results: [SavedProblem] {
    problems.filter {
      query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || $0.title.localizedStandardContains(query.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    .sorted {
      switch sort {
      case "title": return $0.title.localizedStandardCompare($1.title) == .orderedAscending
      case "steps": return $0.steps > $1.steps
      default: return $0.at > $1.at
      }
    }
  }

  var body: some View {
    NavigationStack {
      GeometryReader { space in
        ScrollView {
          VStack(alignment: .leading, spacing: 32) {
            Text("Manage your problems, audio, and information.").foregroundStyle(secondaryInk)
            Button("New problem") {
              if model.perform("new") { model.showSettings = false }
            }.buttonStyle(.bordered).frame(minHeight: 44)
            if space.size.width > 850 && !typeSize.isAccessibilitySize {
              HStack(alignment: .top, spacing: 64) {
                pastProblems.frame(maxWidth: .infinity, alignment: .topLeading)
                preferences.frame(maxWidth: .infinity, alignment: .topLeading)
              }
            } else {
              pastProblems
              preferences
            }
          }
          .padding(space.size.width > 850 ? 32 : 20)
          .frame(maxWidth: 1200, alignment: .leading)
          .frame(maxWidth: .infinity)
        }
      }
      .background(Color.background)
      .navigationTitle("Settings")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Back to problem solving") { model.showSettings = false }
        }
      }
      .navigationDestination(isPresented: $searchOpen) { searchPage }
    }
    .tint(settingsTint)
    .onAppear {
      model.audio.stopListening()
      model.audio.stopSpeaking()
      model.celebration = nil
      if let action = model.requestedExport {
        model.requestedExport = nil
        export(action == "print" ? .pdf : .plainText)
      }
    }
    .sheet(item: $deleting) { problem in
      NavigationStack {
        Form {
          Text("Export a backup first if you want to keep a copy.")
          if !deleteError.isEmpty { Text(deleteError).foregroundStyle(.red) }
          Button("Delete", role: .destructive) {
            if model.perform("delete", text: problem.id) {
              deleting = nil
            } else {
              deleteError = model.message
            }
          }.accessibilityIdentifier("settings.confirmDelete")
        }
        .navigationTitle("Delete \(problem.title)?")
        .toolbar { Button("Cancel") { deleting = nil } }
      }
      .presentationDetents([.medium, .large])
    }
    .alert("Rename problem", isPresented: $renaming) {
      TextField("Problem name", text: $name)
      Button("Save name") { if !model.perform("rename", text: name) { fileStatus = model.message } }
      Button("Cancel", role: .cancel) {}
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
      do {
        let url = try result.get()
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 10_000_000 else { throw WorkbenchFailure("Use a backup smaller than 10 MB.") }
        model.perform("import", text: try String(contentsOf: url, encoding: .utf8))
        fileStatus = model.message
      } catch {
        fileStatus = "Import failed: \(error.localizedDescription) Your existing work is unchanged."
      }
    }
    #if os(iOS)
      .sheet(
        item: $preparedExport,
        onDismiss: {
          if let exportURL {
            try? FileManager.default.removeItem(at: exportURL.deletingLastPathComponent())
          }
          exportURL = nil
          exporting = false
        }
      ) { item in
        NativeExportPicker(url: item.url) { saved in
          fileStatus = saved ? "Export saved." : "Export cancelled."
          preparedExport = nil
        }
      }
    #else
      .fileExporter(
        isPresented: $exporting, document: exportFile, contentType: exportType,
        defaultFilename: filename
      ) { result in
        switch result {
        case .success: fileStatus = "Export saved."
        case .failure(let error): fileStatus = "Export failed: \(error.localizedDescription)"
        }
      }
    #endif

  }

  private var searchPage: some View {
    List {
      Picker("Sort problems", selection: $sort) {
        Text("Most recent").tag("recent")
        Text("Name").tag("title")
        Text("Most steps").tag("steps")
      }.pickerStyle(.menu).accessibilityIdentifier("settings.sort")
      ForEach(results) { problem in problemRow(problem) }
      if !fileStatus.isEmpty { Text(fileStatus).accessibilityIdentifier("settings.fileStatus") }
      if results.isEmpty {
        Text(query.isEmpty ? "No saved problems yet." : "No problems match “\(query)”.")
          .foregroundStyle(secondaryInk)
      }
      Text("\(results.count) \(results.count == 1 ? "problem" : "problems")").foregroundStyle(
        .secondary)
    }
    .listStyle(.plain)
    .searchable(text: $query, placement: .toolbar, prompt: "Search problems…")
    .navigationTitle("Search problems")
    .toolbar { Button("Done") { searchOpen = false } }

  }

  private var pastProblems: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Past problems").font(.title2).bold().accessibilityAddTraits(.isHeader)
        Spacer()
        Button {
          query = ""
          searchOpen = true
        } label: {
          Image(systemName: "magnifyingglass").frame(width: 44, height: 44)
        }.accessibilityLabel("Search problems")
      }
      if problems.isEmpty { Text("No saved problems yet.").foregroundStyle(secondaryInk) }
      ForEach(Array(recent.prefix(visible))) { problem in problemRow(problem) }
      if problems.count > visible {
        Button("Show more") { visible += 5 }.frame(minHeight: 44)
      }
      if visible > 5 { Button("Show less") { visible = 5 }.frame(minHeight: 44) }
    }
  }

  private func problemRow(_ problem: SavedProblem) -> some View {
    HStack(spacing: 4) {
      Button {
        if model.perform("select", text: problem.id) {
          searchOpen = false
          model.showSettings = false
        } else {
          fileStatus = model.message
        }
      } label: {
        HStack {
          Text(problem.title).foregroundStyle(Color.primary).multilineTextAlignment(.leading)
          Spacer(minLength: 8)
          Image(systemName: "arrow.right")
        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }.accessibilityLabel("Open \(problem.title)")
      Button {
        export(.plainText, problemID: problem.id)
      } label: {
        Image(systemName: "arrow.down.to.line").frame(width: 44, height: 44)
      }.accessibilityLabel("Export \(problem.title)").disabled(exportBusy)
      Button {
        deleteError = ""
        deleting = problem
      } label: {
        Image(systemName: "trash").frame(width: 44, height: 44)
      }.accessibilityLabel("Delete \(problem.title)")
    }
    .buttonStyle(.borderless)
    .contextMenu {
      if problem.id == model.document?.problemId {
        Button("Rename problem") {
          name = problem.title
          renaming = true
        }
      }
    }
  }

  private var preferences: some View {
    VStack(alignment: .leading, spacing: 32) {
      settingsSection("Local models") {
        Picker("Model mode", selection: $model.localModelMode) {
          Text("Apple").tag(LocalModelMode.apple)
          Text("Custom").tag(LocalModelMode.custom)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("settings.modelMode")
        Text(
          model.localModelMode == .apple
            ? "Apple speech recognition. Math uses local commands."
            : model.customModelStatus
        )
        .foregroundStyle(secondaryInk)
        .accessibilityIdentifier("settings.modelStatus")
      }
      settingsSection("Account") {
        Text("On this device").font(.headline)
        Text(
          "Your problems are saved locally. This offline version has no account or cloud sync. Use a backup to move your work between devices."
        ).foregroundStyle(secondaryInk)
      }
      settingsSection("Audio") {
        Toggle(isOn: $model.readAutomatically) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Spoken responses")
            Text("Hear Pico’s replies aloud.").font(.subheadline).foregroundStyle(secondaryInk)
          }
        }.accessibilityIdentifier("settings.spoken")
      }
      settingsSection("Celebrations") {
        Toggle(isOn: $model.celebrationsEnabled) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Confetti celebrations")
            Text("Let Pico celebrate verified solutions. Reduced motion uses a still confirmation.")
              .font(.subheadline).foregroundStyle(secondaryInk)
          }
        }.accessibilityIdentifier("settings.celebrations")
      }
      settingsSection("Your data") {
        Text("Export your work").font(.headline)
        Text(
          "Download all problems as text, or save the current problem as a PDF, including its drawing."
        ).foregroundStyle(secondaryInk)
        ViewThatFits(in: .horizontal) {
          HStack {
            textDownload
            pdfDownload
          }
          VStack(alignment: .leading) {
            textDownload
            pdfDownload
          }
        }
        Text("Back up your problems").font(.headline).padding(.top, 16)
        Text(
          "Keep a file you can import later. Importing adds problems without replacing your current work."
        ).foregroundStyle(secondaryInk)
        ViewThatFits(in: .horizontal) {
          HStack {
            backupDownload
            backupImport
          }
          VStack(alignment: .leading) {
            backupDownload
            backupImport
          }
        }
        if model.saveFailed {
          Text(model.message).foregroundStyle(.red)
          Button("Retry saving") { model.flushDraft() }.frame(minHeight: 44)
        }
        if model.storageBlocked {
          Text(model.message).foregroundStyle(.red)
          Button("Preserve unreadable file and start a new library") { model.recoverStorage() }
        }
        if !fileStatus.isEmpty { Text(fileStatus).accessibilityIdentifier("settings.fileStatus") }
      }
    }
  }

  private var textDownload: some View {
    Button("Download text") { export(.plainText) }.buttonStyle(.bordered).controlSize(.large)
      .disabled(exportBusy)
  }
  private var pdfDownload: some View {
    Button("Save PDF") { export(.pdf) }.buttonStyle(.bordered).controlSize(.large).disabled(
      exportBusy)
  }
  private var backupDownload: some View {
    Button("Download backup") { export(.json) }.buttonStyle(.bordered).controlSize(.large).disabled(
      exportBusy)
  }
  private var backupImport: some View {
    Button("Import backup") { importing = true }.buttonStyle(.bordered).controlSize(.large)
  }

  private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 12) {
      Text(title).font(.title2).bold().accessibilityAddTraits(.isHeader)
      content()
    }.frame(maxWidth: .infinity, alignment: .leading)
  }

  /// Materialize the document before presenting the iOS picker, including after rotation.
  private func presentExport() throws {
    #if os(iOS)
      let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
        "Mathwave-export-" + UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let url = folder.appendingPathComponent(filename).appendingPathExtension(
        exportType.preferredFilenameExtension ?? "txt")
      do { try exportFile.data.write(to: url, options: .atomic) } catch {
        try? FileManager.default.removeItem(at: folder)
        throw error
      }
      exportURL = url
      preparedExport = PreparedExport(url: url)
    #endif
    exporting = true
  }

  /// Downloads in-memory work even if saving failed. Row exports never switch problems.
  private func export(_ type: UTType, problemID: String? = nil) {
    guard !exportBusy else { return }
    model.flushDraft()
    do {
      if type == .pdf {
        #if os(iOS)
          preparingPDF = true
          fileStatus = "Preparing PDF…"
          Task {
            defer { preparingPDF = false }
            do {
              let renderer = try SharedPresentationPDF(
                library: model.backupForExport(), draft: model.draft,
                plot: model.document?.plot ?? model.document?.explanation?.plot)
              exportFile = WorkspaceFile(data: try await renderer.make())
              exportType = .pdf
              filename = model.exportFilename
              try presentExport()
            } catch { fileStatus = "Export failed: \(error.localizedDescription)" }
          }
          return
        #else
          exportFile = WorkspaceFile(
            data: try WorkPDF.make(
              model.textForExport(), plot: model.document?.plot ?? model.document?.explanation?.plot
            ))
        #endif
      } else {
        exportFile = WorkspaceFile(
          try type == .json
            ? model.backupForExport()
            : model.textForExport(problemID: problemID, allProblems: problemID == nil))
      }
      exportType = type
      filename = problemID.map { "Mathwave-problem-" + $0 } ?? model.exportFilename
      try presentExport()
    } catch { fileStatus = "Export failed: \(error.localizedDescription)" }
  }
}

#if os(iOS)
  /// A completed local file gives Files the same export contract in either orientation.
  private struct NativeExportPicker: UIViewControllerRepresentable {
    let url: URL
    let completion: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
      let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
      picker.delegate = context.coordinator
      return picker
    }
    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
      let completion: (Bool) -> Void
      init(completion: @escaping (Bool) -> Void) { self.completion = completion }
      func documentPicker(
        _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
      ) { completion(!urls.isEmpty) }
      func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        completion(false)
      }
    }
  }
#endif

private struct PreparedExport: Identifiable {
  let url: URL
  var id: URL { url }
}
