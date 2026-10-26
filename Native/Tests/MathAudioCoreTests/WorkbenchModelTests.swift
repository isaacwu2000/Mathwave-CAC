import Foundation
import AVFoundation
import CoreGraphics
import SQLite3
import Testing
@testable import MathAudioApp
import MathAudioCore

@MainActor
struct WorkbenchModelTests {
  @Test func legacyLibraryMigratesToSQLiteWithDraftHistoryAndBackupIntact() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let legacy = directory.appendingPathComponent("library.json")
    let engine = try SharedWorkbench()
    let equation = try engine.perform("command", text: "write x+6=8")
    let graph = try engine.perform("command", library: equation.library, text: "graph y=x^2")
    let drafted = try engine.perform("draft", library: graph.library, text: "unfinished request")
    let original = Data(drafted.library.utf8)
    try original.write(to: legacy)
    let model = WorkbenchModel(storageURL: url)
    #expect(!model.storageBlocked)
    #expect(model.document?.library == drafted.library)
    #expect(model.draft == "unfinished request")
    #expect(try Data(contentsOf: legacy) == original)
    #expect(try Data(contentsOf: url).prefix(16) == Data("SQLite format 3\0".utf8))
    #expect(try model.backupForExport() == drafted.library)
    #expect(model.perform("command", text: "undo"))
    #expect(model.document?.expression == "x + 6 = 8")
    let reopened = WorkbenchModel(storageURL: url)
    #expect(reopened.document?.expression == "x + 6 = 8")
    #expect(reopened.perform("command", text: "redo"))
    #expect(reopened.document?.plot != nil)
  }

  @Test func firstLaunchUsesCustomWhenInstalledAndOtherwiseApple() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveModeTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    let url = directory.appendingPathComponent("work.sqlite")
    let custom = WorkbenchModel(storageURL: url, preferences: preferences, customModelsInstalled: true)
    #expect(custom.localModelMode == .custom)
    #expect(custom.audio.modelMode == .custom)
    preferences.removeObject(forKey: "native.localModelMode")
    let standard = WorkbenchModel(storageURL: url, preferences: preferences, customModelsInstalled: false)
    #expect(standard.localModelMode == .apple)
    #expect(standard.audio.modelMode == .apple)
    custom.localModelMode = .apple
    #expect(WorkbenchModel(storageURL: url, preferences: preferences, customModelsInstalled: true).localModelMode == .apple)
    custom.localModelMode = .custom
    #expect(WorkbenchModel(storageURL: url, preferences: preferences, customModelsInstalled: false).localModelMode == .custom)
  }

  @Test func staleWindowCannotOverwriteNewerSQLiteWork() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let first = WorkbenchModel(storageURL: url)
    let stale = WorkbenchModel(storageURL: url)
    #expect(first.perform("command", text: "write x=4"))
    stale.draft = "write x=9"
    stale.submit()
    #expect(stale.saveFailed)
    #expect(stale.message.contains("another window"))
    #expect(stale.draft == "write x=9")
    #expect(WorkbenchModel(storageURL: url).document?.expression == "x = 4")
    #expect(try stale.backupForExport().contains("write x=9"))
  }

  @Test func invalidLegacyWorkIsPreservedUntilExplicitRecovery() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let legacy = directory.appendingPathComponent("library.json")
    try Data("unreadable legacy".utf8).write(to: legacy)
    let model = WorkbenchModel(storageURL: url)
    #expect(model.storageBlocked)
    #expect(!FileManager.default.fileExists(atPath: url.path))
    #expect(try model.backupForExport() == "unreadable legacy")
    model.recoverStorage()
    #expect(!model.storageBlocked)
    #expect(try String(contentsOf: legacy, encoding: .utf8) == "unreadable legacy")
    #expect(WorkbenchModel(storageURL: url).document != nil)
    let archives = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("unreadable-") }
    let archive = try #require(archives.first)
    #expect(try String(contentsOf: archive.appendingPathComponent("library.json"), encoding: .utf8) == "unreadable legacy")
  }

  @Test func lockedDatabaseKeepsWorkAndAllowsRetry() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let model = WorkbenchModel(storageURL: url)
    #expect(model.perform("command", text: "write x=4"))
    var db: OpaquePointer?
    #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
    let connection = try #require(db)
    defer { sqlite3_close(connection) }
    #expect(sqlite3_exec(connection, "BEGIN EXCLUSIVE", nil, nil, nil) == SQLITE_OK)
    defer { sqlite3_exec(connection, "ROLLBACK", nil, nil, nil) }
    model.draft = "write x=7"
    model.submit()
    #expect(model.saveFailed)
    #expect(model.document?.expression == "x = 4")
    #expect(model.draft == "write x=7")
    #expect(sqlite3_exec(connection, "ROLLBACK", nil, nil, nil) == SQLITE_OK)
    model.submit()
    #expect(!model.saveFailed)
    #expect(model.document?.expression == "x = 7")
    #expect(WorkbenchModel(storageURL: url).document?.expression == "x = 7")
  }

  @Test func recoveryCannotEraseWorkAfterATemporaryLockClears() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let first = WorkbenchModel(storageURL: url)
    var db: OpaquePointer?
    #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
    let connection = try #require(db)
    defer { sqlite3_close(connection) }
    #expect(sqlite3_exec(connection, "BEGIN EXCLUSIVE", nil, nil, nil) == SQLITE_OK)
    defer { sqlite3_exec(connection, "ROLLBACK", nil, nil, nil) }
    let blocked = WorkbenchModel(storageURL: url)
    #expect(blocked.storageBlocked)
    blocked.recoverStorage()
    #expect(blocked.storageBlocked)
    #expect(sqlite3_exec(connection, "ROLLBACK", nil, nil, nil) == SQLITE_OK)
    #expect(first.perform("command", text: "write x=4"))
    blocked.recoverStorage()
    #expect(blocked.storageBlocked)
    #expect(blocked.message.contains("Reopen"))
    #expect(WorkbenchModel(storageURL: url).document?.expression == "x = 4")
  }

  @Test func recoveredDatabaseRejectsWritersFromTheOriginalLibrary() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("library.sqlite")
    let original = WorkbenchModel(storageURL: url)
    var db: OpaquePointer?
    #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
    let connection = try #require(db)
    #expect(sqlite3_exec(connection, "UPDATE problem_library SET library = 'unreadable' WHERE id = 1", nil, nil, nil) == SQLITE_OK)
    sqlite3_close(connection)
    let blocked = WorkbenchModel(storageURL: url)
    #expect(blocked.storageBlocked)
    blocked.recoverStorage()
    #expect(!blocked.storageBlocked)
    #expect(!original.perform("command", text: "write x=9"))
    #expect(original.saveFailed)
    #expect(WorkbenchModel(storageURL: url).document?.expression == "0")
  }

  @Test func JSONBackupImportsIntoSQLiteWithoutReplacingExistingProblems() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = WorkbenchModel(storageURL: directory.appendingPathComponent("source.sqlite"))
    #expect(source.perform("command", text: "write x+6=8"))
    source.draft = "finish this later"
    source.flushDraft()
    let backup = try source.backupForExport()
    let url = directory.appendingPathComponent("destination.sqlite")
    let destination = WorkbenchModel(storageURL: url)
    #expect(destination.perform("command", text: "write x=9"))
    #expect(destination.perform("import", text: backup))
    let reopened = WorkbenchModel(storageURL: url)
    #expect(reopened.document?.problems.count == 2)
    let text = try reopened.textForExport(allProblems: true)
    #expect(text.contains("x + 6 = 8"))
    #expect(text.contains("x = 9"))
    #expect(text.contains("finish this later"))
  }

  @Test func picoClarificationAndRetryNeverPretendToSpeak() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwavePicoTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    var status = "clarification"
    let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences,
      customInterpreter: { _ in
        return "{\"answer\":{\"status\":\"\(status)\",\"programs\":[],\"message\":\"Which side?\",\"presentation\":null}}"
      })
    model.localModelMode = .custom
    model.draft = "Change that side to five."
    model.submit()
    for _ in 0..<200 where model.isRunningCustom { try await Task.sleep(nanoseconds: 10_000_000) }
    #expect(model.picoActivity.label == "Pico: waiting for clarification")
    #expect(!model.picoActivity.speaking)
    status = "unsupported"
    model.draft = "Use that feature."
    model.submit()
    for _ in 0..<200 where model.isRunningCustom { try await Task.sleep(nanoseconds: 10_000_000) }
    #expect(model.picoActivity.label == "Pico: ready to retry")
    #expect(model.picoActivity.progress == nil)
    model.perform("new")
    #expect(model.picoActivity.label == "Pico: ready")
  }

  @Test func picoReportsConcurrentVoiceActivityAndClearsWorkingOnCancellation() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwavePicoTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences,
      customInterpreter: { _ in
        try await Task.sleep(nanoseconds: 5_000_000_000)
        throw CancellationError()
      })
    model.localModelMode = .custom
    #expect(model.picoActivity.label == "Pico: ready")
    model.draft = "Put down two x plus three equals eleven."
    model.submit()
    #expect(model.picoActivity.working)
    #expect(model.picoActivity.progress == "Working…")
    model.audio.isListening = true
    model.audio.isSpeaking = true
    #expect(model.picoActivity.label == "Pico: listening, working, speaking")
    model.cancelCustomRun()
    #expect(!model.picoActivity.working)
    #expect(model.picoActivity.progress == nil)
    #expect(model.message == "Stopped.")
    model.audio.stopListening()
    model.audio.stopSpeaking()
    await model.audio.toggleListening()
    #expect(model.picoActivity.attention == .unavailable)
    model.audio.stopListening()
    model.audio.stopSpeaking()
  }

  @Test func localModelModePersistsAndNeverFallsBackToAppleSpeech() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    let url = directory.appendingPathComponent("work.sqlite")
    let model = WorkbenchModel(storageURL: url, preferences: preferences)
    #expect(model.localModelMode == .apple)
    model.draft = "write x+3=8"
    model.localModelMode = .custom
    await model.audio.toggleListening()
    #expect(!model.audio.isStarting)
    #expect(!model.audio.isListening)
    #expect(model.audio.voiceFailure?.contains("not installed") == true)
    #expect(model.draft == "write x+3=8")
    let reopened = WorkbenchModel(storageURL: url, preferences: preferences)
    #expect(reopened.localModelMode == .custom)
    #expect(reopened.audio.modelMode == .custom)
    reopened.localModelMode = .apple
    #expect(reopened.audio.voiceFailure == nil)
    #expect(WorkbenchModel(storageURL: url, preferences: preferences).localModelMode == .apple)
  }

  @Test func finalAppleSpeechRunsOnceWhilePartialsAndCancelledSpeechDoNotRun() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveVoiceTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences)
    model.audio.isListening = true
    model.audio.receiveRecognizedText("write x=", isFinal: false)
    #expect(model.document?.expression == "0")
    model.audio.receiveRecognizedText("write x=7", isFinal: true)
    #expect(model.document?.expression == "x = 7")
    #expect(model.draft.isEmpty)
    let saved = model.document?.library
    model.audio.receiveRecognizedText("write x=99", isFinal: true)
    #expect(model.document?.library == saved)
    model.audio.isListening = true
    model.audio.receiveRecognizedText("write x=", isFinal: false)
    model.audio.stopListening()
    model.audio.receiveRecognizedText("write x=99", isFinal: true)
    #expect(model.document?.library == saved)
    model.audio.isListening = true
    model.audio.receiveRecognizedText("   ", isFinal: true)
    #expect(model.document?.library == saved)
  }

  @Test func finalCustomSpeechAutomaticallyRunsSharedDSLWithoutManualSubmit() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveVoiceTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    var calls = 0
    let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences,
      customInterpreter: { _ in
        calls += 1
        return #"{"answer":{"status":"command","programs":["problem.save(math.equation(\"2*x+3=11\"));"],"message":"","presentation":null}}"#
      })
    model.localModelMode = .custom
    model.audio.status = "Stale status"
    model.audio.isListening = true
    model.audio.receiveRecognizedText("write two x", isFinal: false)
    #expect(calls == 0)
    model.audio.receiveRecognizedText("Put down two x plus three equals eleven.", isFinal: true)
    for _ in 0..<200 where model.isRunningCustom { try await Task.sleep(nanoseconds: 10_000_000) }
    #expect(calls == 1)
    #expect(model.document?.expression == "2 * x + 3 = 11")
    #expect(model.draft.isEmpty)
    #expect(model.audio.status.isEmpty)
    #expect(!model.audio.isTranscribing)
  }

  @Test func worksheetNavigationInvalidatesPendingFinalSpeech() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveVoiceTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences)
    model.audio.isListening = true
    model.audio.receiveRecognizedText("write x=99", isFinal: false)
    model.audio.isSpeaking = true
    model.perform("new", text: "Next worksheet")
    #expect(model.audio.transcript.isEmpty)
    #expect(!model.audio.isSpeaking)
    let saved = model.document?.library
    model.audio.receiveRecognizedText("write x=99", isFinal: true)
    #expect(model.document?.library == saved)
    #expect(model.document?.expression == "0")
  }

  @Test func verificationPathsFollowTheCurrentContainerAndRejectEscapes() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let home = directory.appendingPathComponent("current-container", isDirectory: true)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let expected = home.appendingPathComponent("Documents/verification/clip.wav")
      .standardizedFileURL.resolvingSymlinksInPath()
    #expect(NativeVerification.authorizedURL("Documents/verification/clip.wav", home: home) == expected)
    #expect(NativeVerification.authorizedURL(expected.path, home: home) == expected)
    #expect(NativeVerification.authorizedURL("Documents/../outside.wav", home: home) == nil)
    #expect(NativeVerification.authorizedURL(home.path + "-other/clip.wav", home: home) == nil)
    #expect(NativeVerification.authorizedURL("", home: home) == nil)
    let link = home.appendingPathComponent("escape")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: directory)
    #expect(NativeVerification.authorizedURL("escape/outside.wav", home: home) == nil)
  }

  @Test func customSpeechConvertsRecordedSamplesToMonoSixteenKilohertz() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString + ".wav")
    defer { try? FileManager.default.removeItem(at: url) }
    let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
    let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800))
    buffer.frameLength = 4800
    let channel = try #require(buffer.floatChannelData?[0])
    for frame in 0..<4800 { channel[frame] = 0.25 }
    try autoreleasepool {
      var writer: AVAudioFile? = try AVAudioFile(forWriting: url, settings: format.settings)
      try writer?.write(from: buffer)
      writer = nil
    }
    let samples = try CustomSpeechSamples.read(url)
    #expect((1590...1610).contains(samples.count))
    #expect(samples.dropFirst(50).dropLast(50).allSatisfy { abs($0 - 0.25) < 0.01 })
  }

  @Test func customRunPublishesValidatedWorkAndKeepsItsMode() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    var calls = 0
    let model = WorkbenchModel(
      storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences,
      customInterpreter: { _ in
        calls += 1
        return
          #"{"answer":{"status":"command","programs":["problem.save(math.subtractBothSides(problem.currentEquation(),3));","problem.save(math.simplify(problem.currentEquation()));"],"message":"","presentation":null}}"#
      })
    model.draft = "write 2*x+3=11"
    model.submit()
    model.localModelMode = .custom
    model.draft = "Take three away, then simplify it."
    model.submit()
    for _ in 0..<200 where model.isRunningCustom { try await Task.sleep(nanoseconds: 10_000_000) }
    #expect(calls == 1)
    #expect(model.document?.expression == "2 * x = 8")
    #expect(model.draft.isEmpty)
    #expect(model.localModelMode == .custom)
  }

  @Test func changingDraftCancelsCustomRunWithoutPublishingStaleWork() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "MathwaveTests." + UUID().uuidString
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    var started = false
    let model = WorkbenchModel(
      storageURL: directory.appendingPathComponent("work.sqlite"), preferences: preferences,
      customInterpreter: { _ in
        started = true
        try await Task.sleep(nanoseconds: 5_000_000_000)
        return
          #"{"answer":{"status":"command","programs":["problem.save(math.equation(\"x=99\"));"],"message":"","presentation":null}}"#
      })
    model.draft = "write x=4"
    model.submit()
    model.localModelMode = .custom
    model.draft = "Please carry out the adjustment we discussed."
    model.submit()
    for _ in 0..<200 where !started { try await Task.sleep(nanoseconds: 10_000_000) }
    #expect(started)
    model.draft = "keep my new draft"
    model.scheduleDraftSave()
    await Task.yield()
    #expect(!model.isRunningCustom)
    #expect(model.document?.expression == "x = 4")
    #expect(model.draft == "keep my new draft")
  }

    @Test func draftAndMathematicsSurviveAppRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("library.sqlite")
        let model = WorkbenchModel(storageURL: url)
        model.draft = "write x+6=8"; model.submit()
        #expect(model.document?.expression == "x + 6 = 8")
        model.draft = "replace six with"; model.flushDraft()
        let reopened = WorkbenchModel(storageURL: url)
        #expect(reopened.draft == "replace six with")
        #expect(reopened.document?.expression == "x + 6 = 8")
        reopened.submit()
        #expect(reopened.document?.expression == "x + 6 = 8")
        let afterFailure = WorkbenchModel(storageURL: url)
        #expect(afterFailure.draft == "replace six with")
        #expect(afterFailure.document?.expression == "x + 6 = 8")
    }

    @Test func unreadableLibrariesRequireExplicitRecovery() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("library.sqlite")
        try Data("unreadable original".utf8).write(to: url)
        let model = WorkbenchModel(storageURL: url)
        #expect(model.storageBlocked)
        let archiveJSON = try JSONSerialization.jsonObject(with: Data(model.backupForExport().utf8)) as? [String: Any]
        #expect(archiveJSON?["format"] as? String == "mathwave-unreadable-sqlite")
        let archivedFiles = try #require(archiveJSON?["files"] as? [String: String])
        #expect(Data(base64Encoded: try #require(archivedFiles["library.sqlite"])) == Data("unreadable original".utf8))
        model.draft = "write x=4"; model.submit(); model.flushDraft()
        #expect(try String(contentsOf: url, encoding: .utf8) == "unreadable original")
        model.recoverStorage()
        #expect(!model.storageBlocked)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let archive = try #require(files.first { $0.lastPathComponent.hasPrefix("unreadable-") })
        let original = archive.appendingPathComponent("library.sqlite")
        #expect(try String(contentsOf: original, encoding: .utf8) == "unreadable original")
        #expect(WorkbenchModel(storageURL: url).document != nil)
    }

    @Test func failedSavingDoesNotPublishAnUnsavedMathematicalChange() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("library.sqlite")
        let model = WorkbenchModel(storageURL: url)
        model.draft = "write x=4"; model.submit()
        // A directory in place of the database deterministically makes a save fail.
        let retained = directory.appendingPathComponent("retained.sqlite")
        try FileManager.default.moveItem(at: url, to: retained)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        model.draft = "write x=7"; model.submit()
        #expect(model.document?.expression == "x = 4")
        #expect(model.draft == "write x=7")
        #expect(model.message.contains("unchanged"))
        let backup = try SharedWorkbench().perform("open", library: model.backupForExport())
        #expect(backup.draft == "write x=7")
        #expect(try model.textForExport().contains("Unsubmitted draft: write x=7"))
    }

    @Test func libraryExportIncludesAllProblemsAndUnsubmittedDrafts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = WorkbenchModel(storageURL: directory.appendingPathComponent("work.sqlite"))
        model.draft = "write x+6=8"; model.submit()
        let firstID = try #require(model.document?.problemId)
        model.perform("new", text: "Geometry homework")
        model.draft = "right triangle with legs three and four"
        let all = try model.textForExport(allProblems: true)
        #expect(all.contains("x + 6 = 8"))
        #expect(all.contains("Geometry homework"))
        #expect(all.contains("Unsubmitted draft: right triangle with legs three and four"))
        let individual = try model.textForExport(problemID: firstID)
        #expect(individual.contains("x + 6 = 8"))
        #expect(!individual.contains("Geometry homework"))
        #expect(model.document?.problemId != firstID)
        #expect(model.draft == "right triangle with legs three and four")
    }

    @Test func pdfExportIncludesTheCurrentDrawing() throws {
        let graph = try SharedWorkbench().perform("command", text: "graph y=x^2")
        let plain = try WorkPDF.make(graph.exportText)
        let drawn = try WorkPDF.make(graph.exportText, plot: graph.plot)
        let provider = try #require(CGDataProvider(data: drawn as CFData))
        let pdf = try #require(CGPDFDocument(provider))
        #expect(pdf.numberOfPages == 2)
        #expect(drawn.count > plain.count)
        let page = try #require(pdf.page(at: 2))
        let context = try #require(CGContext(data: nil, width: 612, height: 792, bitsPerComponent: 8, bytesPerRow: 612 * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 612, height: 792))
        context.drawPDFPage(page)
        let pixels = try #require(context.data).assumingMemoryBound(to: UInt8.self)
        // For y = x², (2, 4) lies on the curve; (2, -4) does not. Gray grid lines do not count.
        func coloredPixels(x: Int, y: Int) -> Int {
            var count = 0
            for row in (y - 4)...(y + 4) {
                for column in (x - 4)...(x + 4) {
                    // Bitmap rows run downward; PDF coordinates run upward.
                    let offset = ((791 - row) * 612 + column) * 4
                    let channels = [Int(pixels[offset]), Int(pixels[offset + 1]), Int(pixels[offset + 2])]
                    if channels.max()! - channels.min()! > 50 { count += 1 }
                }
            }
            return count
        }
        #expect(coloredPixels(x: 358, y: 501) > 0)
        #expect(coloredPixels(x: 358, y: 295) == 0)
        if let path = ProcessInfo.processInfo.environment["MATH_AUDIO_PDF_EVIDENCE"] {
            try drawn.write(to: URL(fileURLWithPath: path))
        }
    }

    @Test func preferencesPersistAndCelebrationsRespectOptOutAndReceipts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let suite = "MathwaveTests." + UUID().uuidString
        let preferences = try #require(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let url = directory.appendingPathComponent("work.sqlite")
        let model = WorkbenchModel(storageURL: url, preferences: preferences)
        model.readAutomatically = false
        model.celebrationsEnabled = false
        model.perform("command", text: "write 2*x+3=11")
        model.perform("command", text: "solve")
        #expect(model.celebration == "Solution checked: x = 4")
        #expect(!model.celebrationActive)
        model.revisionDrafts["mathwave-revision:" + (model.document?.problemId ?? "")] = "unfinished branch equation"
        model.readAutomatically = true
        let reopened = WorkbenchModel(storageURL: url, preferences: preferences)
        #expect(reopened.readAutomatically)
        #expect(reopened.revisionDrafts == model.revisionDrafts)
        reopened.readAutomatically = false
        #expect(!reopened.celebrationsEnabled)
        reopened.celebrationsEnabled = true
        reopened.perform("command", text: "solve")
        #expect(reopened.celebration == nil)
        reopened.perform("new")
        reopened.perform("command", text: "write 2*x+3=11")
        reopened.perform("command", text: "solve")
        #expect(reopened.celebration == "Solution checked: x = 4")
        #expect(reopened.celebrationActive)
        reopened.perform("command", text: "solve")
        #expect(reopened.celebration == nil)
        #expect(WorkbenchModel(storageURL: url, preferences: preferences).celebration == nil)
    }

    @Test func failedDeletionPreservesTheProblemAndCanBeRetried() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("work.sqlite")
        let model = WorkbenchModel(storageURL: url)
        model.perform("command", text: "write x+6=8")
        let id = try #require(model.document?.problemId)
        let retained = directory.appendingPathComponent("retained.sqlite")
        try FileManager.default.moveItem(at: url, to: retained)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        #expect(!model.perform("delete", text: id))
        #expect(model.saveFailed)
        #expect(model.document?.problems.contains { $0.id == id } == true)
        try FileManager.default.removeItem(at: url)
        try FileManager.default.moveItem(at: retained, to: url)
        #expect(model.perform("delete", text: id))
        #expect(!model.saveFailed)
        #expect(model.document?.problems.contains { $0.id == id } == false)
        #expect(model.document?.problems.count == 1)
    }

    @Test func pdfExportPaginatesLongWork() throws {
        let text = (1...200).map { "Step \($0): x + 3 = 11" }.joined(separator: "\n")
        let data = try WorkPDF.make(text)
        let provider = try #require(CGDataProvider(data: data as CFData))
        let pdf = try #require(CGPDFDocument(provider))
        #expect(pdf.numberOfPages > 1)
    }
}
