import XCTest

final class MathwaveUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app = XCUIApplication()
    app.launchEnvironment["MATH_AUDIO_UI_TEST_ID"] = UUID().uuidString
    app.launchEnvironment["MATHWAVE_TEST_COMMAND_ENTRY"] = "1"
    app.launch()
    openWorkspace()
  }

  override func tearDownWithError() throws {
    if let testRun, testRun.failureCount > 0 {
      capture("failure-state")
      let hierarchy = XCTAttachment(string: app.debugDescription)
      hierarchy.name = "failure-hierarchy"
      hierarchy.lifetime = .keepAlways
      add(hierarchy)
    }
  }

  private func openWorkspace() {
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["Voice input"].exists)
  }

  private var input: XCUIElement {
    app.descendants(matching: .any).matching(identifier: "command.input").firstMatch
  }
  private var latestExpression: XCUIElement {
    app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH %@", "Focus step ")
    ).firstMatch
  }
  private var graphCanvas: XCUIElement {
    app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH %@", "Graph. ")
    ).firstMatch
  }
  private var status: XCUIElement { app.staticTexts["workspace.status"] }

  private func openCommandEntry() {
    let options =
      app.buttons["Command options"].exists
      ? app.buttons["Command options"] : app.buttons["Workspace options"]
    options.tap()
    app.buttons["Enter a command"].tap()
  }

  private func command(_ text: String) {
    if !app.buttons["Run command"].exists {
      openCommandEntry()
    }
    if app.buttons["Use plain text"].exists { app.buttons["Use plain text"].tap() }
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    if let value = input.value as? String, !value.isEmpty, value != "Type math or a command" {
      input.typeKey("a", modifierFlags: .command)
      input.typeText(XCUIKeyboardKey.delete.rawValue)
    }
    input.typeText(text)
    XCTAssertEqual(input.value as? String, text)
    app.buttons["Run command"].tap()
    if !app.buttons["Run command"].waitForNonExistence(timeout: 3) { app.buttons["Done"].tap() }
    let opening = app.descendants(matching: .any).matching(identifier: "presentation.loading")
      .firstMatch
    XCTAssertTrue(opening.waitForNonExistence(timeout: 10))
    if status.exists {
      XCTAssertFalse(status.label.contains("could not"), status.label)
    } else {
      XCTAssertTrue(
        app.buttons["Back to problem solving"].exists,
        "A panel command must open Settings when the worksheet is hidden.")
    }
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func showPlot() {
    app.webViews.firstMatch.swipeUp()
  }

  func testSpeechRuntimeFailureOffersRecovery() {
    app.buttons["Voice input"].tap()
    let setup = app.buttons["Set up English speech"]
    if setup.waitForExistence(timeout: 3) {
      setup.tap()
      let unavailable = app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "runtime cannot")
      ).firstMatch
      XCTAssertTrue(unavailable.waitForExistence(timeout: 15))
      capture("speech-runtime-recovery")
      app.buttons["Enter a command"].tap()
      XCTAssertTrue(app.buttons["Run command"].waitForExistence(timeout: 5))
    } else {
      XCTAssertTrue(app.buttons["Stop recording"].waitForExistence(timeout: 5))
      app.buttons["Stop recording"].tap()
    }
  }

  // Run voice acceptance with silent microphone input so an old draft cannot
  // be mistaken for newly recognized speech.
  func testSilentRecordingPreservesDraftWithoutOpeningReview() {
    let draft = "write two x plus three equals eleven"
    openCommandEntry()
    if app.buttons["Use plain text"].exists { app.buttons["Use plain text"].tap() }
    input.tap()
    input.typeText(draft)
    app.buttons["Done"].tap()

    app.buttons["Voice input"].tap()
    let stop = app.buttons["Stop recording"]
    XCTAssertTrue(stop.waitForExistence(timeout: 5))
    stop.tap()
    XCTAssertFalse(app.buttons["Run command"].waitForExistence(timeout: 2))
    capture("silent-recording-keeps-workspace")

    openCommandEntry()
    if app.buttons["Use plain text"].exists { app.buttons["Use plain text"].tap() }
    XCTAssertEqual(input.value as? String, draft)
  }

  func testDirectLaunchReadiness() {
    app.terminate()
    let options = XCTMeasureOptions()
    options.iterationCount = 3
    measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
      app.launch()
      XCTAssertTrue(app.buttons["Voice input"].waitForExistence(timeout: 8))
      XCTAssertTrue(app.buttons["Voice input"].isHittable)
    }
  }

  func testVoiceFirstHomeLayout() {
    let heading = app.staticTexts["What math shall we play with today?"]
    let voice = app.buttons["Voice input"]
    let viewport = app.windows.firstMatch.frame
    XCTAssertTrue(heading.exists)
    XCTAssertLessThan(heading.frame.maxY, voice.frame.minY)
    XCTAssertGreaterThan(voice.frame.midY, viewport.height * 0.35)
    XCTAssertLessThan(voice.frame.midY, viewport.height * 0.65)
    XCTAssertFalse(app.staticTexts["“Draw a triangle with sides 3, 4, and 5.”"].exists)
    XCTAssertFalse(app.buttons["Type a problem"].exists)
    XCTAssertFalse(app.buttons["Type a command"].exists)
    capture("voice-first-home")
  }

  func testVoiceFirstHomeLargeText() {
    app.terminate()
    app.launchArguments += [
      "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
    ]
    app.launch()
    openWorkspace()
    let heading = app.staticTexts["What math shall we play with today?"]
    let voice = app.buttons["Voice input"]
    XCTAssertTrue(heading.exists)
    XCTAssertLessThan(heading.frame.maxY, voice.frame.minY)
    capture("voice-home-large-text-top")
    if !voice.isHittable { app.swipeUp() }
    XCTAssertTrue(voice.isHittable)
    XCTAssertTrue(app.buttons["Workspace options"].isHittable)
    capture("voice-home-large-text-microphone")
    openCommandEntry()
    XCTAssertTrue(app.buttons["Run command"].waitForExistence(timeout: 5))
  }

  func testSettingsCanStartNewWorkAndLandscapeKeepsResults() {
    command("write 2+3")
    app.buttons["Settings"].tap()
    app.buttons["New problem"].tap()
    XCTAssertTrue(
      app.staticTexts["What math shall we play with today?"].waitForExistence(timeout: 5))
    XCUIDevice.shared.orientation = .landscapeLeft
    let rotated = XCTNSPredicateExpectation(
      predicate: NSPredicate { [self] _, _ in
        app.windows.firstMatch.frame.width > app.windows.firstMatch.frame.height
      }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 8), .completed)
    command("write 7+8")
    command("simplify")
    XCTAssertTrue(status.exists)
    XCTAssertTrue(status.label.contains("15"), status.label)
    XCTAssertTrue(status.isHittable)
    XCTAssertGreaterThanOrEqual(status.frame.minY, app.windows.firstMatch.frame.minY)
    XCTAssertLessThanOrEqual(status.frame.maxY, app.windows.firstMatch.frame.maxY)
    XCTAssertTrue(
      app.webViews.firstMatch.frame.contains(latestExpression.frame),
      "The focused equation must fit inside its visible math surface.")
    capture("landscape-visible-result")
    XCUIDevice.shared.orientation = .portrait
  }

  func testSharedMathRenderingAndHelpRemoval() {
    command("write (x+1)/3=5")
    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 10))
    capture("iphone-shared-fraction-notation")
    app.buttons["Explore work"].tap()
    XCTAssertTrue(app.buttons["Read work"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Command guide"].exists)
    app.buttons["Done"].tap()
    openCommandEntry()
    app.buttons["Use math keyboard"].tap()
    let mathField = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", "Math or command input")
    ).firstMatch
    XCTAssertTrue(mathField.waitForExistence(timeout: 10))
    mathField.tap()
    let seven = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "7"))
      .firstMatch
    XCTAssertTrue(seven.waitForExistence(timeout: 5))
    seven.tap()
    capture("iphone-shared-math-editor")
    app.buttons["Use plain text"].tap()
    XCTAssertEqual(input.value as? String, "7")
  }

  func testAlgebraUndoRedoAndRelaunch() {
    command("write two x plus three equals eleven")
    XCTAssertTrue(latestExpression.label.contains("11"))
    command("subtract three from both sides")
    command("divide both sides by two")
    command("simplify")
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 10))
    XCTAssertTrue(latestExpression.label.contains("4"))
    capture("algebra-solved")
    app.buttons["Undo"].tap()
    XCTAssertTrue(app.buttons["Redo"].isEnabled)
    app.buttons["Redo"].tap()
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 10))
    XCTAssertTrue(latestExpression.label.contains("4"))
    app.terminate()
    app.launch()
    openWorkspace()
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 10))
    XCTAssertTrue(latestExpression.label.contains("4"))
    capture("algebra-persisted-after-relaunch")
  }

  func testSQLiteMigrationAndRelaunch() throws {
    guard let identifier = ProcessInfo.processInfo.environment["MATHWAVE_SQLITE_MIGRATION_ID"] else {
      throw XCTSkip("Stage an isolated legacy JSON library before running this migration check.")
    }
    app.terminate()
    app.launchEnvironment["MATH_AUDIO_UI_TEST_ID"] = identifier
    app.launch()
    openWorkspace()
    XCTAssertTrue(graphCanvas.waitForExistence(timeout: 10))
    capture("sqlite-migrated-parabola")
    app.buttons["Settings"].tap()
    app.segmentedControls["settings.modelMode"].buttons["Apple"].tap()
    app.buttons["Back to problem solving"].tap()
    openCommandEntry()
    if app.buttons["Use plain text"].exists { app.buttons["Use plain text"].tap() }
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertEqual(input.value as? String, "unfinished request")
    capture("sqlite-migrated-draft")
    app.buttons["Done"].tap()
    app.terminate()
    app.launch()
    openWorkspace()
    XCTAssertTrue(graphCanvas.waitForExistence(timeout: 10))
    capture("sqlite-parabola-after-relaunch")
    app.buttons["Undo"].tap()
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 10))
    XCTAssertTrue(latestExpression.label.contains("6"))
    XCTAssertTrue(latestExpression.label.contains("8"))
    capture("sqlite-migrated-undo")
    app.buttons["Redo"].tap()
    XCTAssertTrue(graphCanvas.waitForExistence(timeout: 10))
    capture("sqlite-migrated-redo")
  }

  func testGraphGeometryStatisticsAndInvalidCommand() {
    command("graph y equals x squared")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label BEGINSWITH %@", "Graph. ")
      ).firstMatch
        .waitForExistence(timeout: 5))
    command("trace graph one at x two")
    XCTAssertTrue(status.label.contains("4"), status.label)
    showPlot()
    capture("graph-with-trace")
    command("right triangle with legs three and four")
    command("find its hypotenuse")
    XCTAssertTrue(status.label.contains("5"), status.label)
    showPlot()
    capture("geometry-triangle")
    command("data 4, 8, 10, 14")
    command("mean")
    XCTAssertTrue(status.label.contains("9"), status.label)
    let more = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", "More calculations")
    ).firstMatch
    XCTAssertTrue(more.exists)
    XCTAssertFalse(app.buttons["Sample standard deviation"].isHittable)
    more.tap()
    XCTAssertTrue(app.buttons["Sample standard deviation"].waitForExistence(timeout: 5))
    capture("statistics-mean")
    command("replace it with seven")
    XCTAssertTrue(status.label.contains("unchanged"), status.label)
    capture("ambiguous-command-preserves-work")
  }

  private func saveExport(_ screenshot: String) {
    // Files loads in a separate process; its filename editor varies by iOS release.
    let save = app.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 30))
    XCTAssertTrue(save.isHittable)
    capture(screenshot)
    save.tap()
    XCTAssertTrue(save.waitForNonExistence(timeout: 8))
  }

  func testLocalModelModesPersistAndRecoverWithoutFallback() {
    app.buttons["Settings"].tap()
    let picker = app.segmentedControls["settings.modelMode"]
    XCTAssertTrue(picker.waitForExistence(timeout: 5))
    if !picker.isHittable { app.swipeUp() }
    XCTAssertTrue(picker.buttons["Apple"].isSelected)
    capture("local-models-apple")
    picker.buttons["Custom"].tap()
    XCTAssertTrue(picker.buttons["Custom"].isSelected)
    let status = app.staticTexts["settings.modelStatus"].label
    let unavailable = status.contains("not installed")
    XCTAssertTrue(unavailable || status.contains("are installed"), status)
    capture(unavailable ? "local-models-custom-unavailable" : "local-models-custom-ready")
    app.terminate()
    app.launch()
    openWorkspace()
    app.buttons["Settings"].tap()
    XCTAssertTrue(picker.waitForExistence(timeout: 5))
    if !picker.isHittable { app.swipeUp() }
    XCTAssertTrue(picker.buttons["Custom"].isSelected)
    if unavailable {
      // Retain recovery coverage for builds with no bundled models. Installed
      // builds verify persistence without starting microphone input or inference.
      app.buttons["Back to problem solving"].tap()
      app.buttons["Voice input"].tap()
      XCTAssertTrue(app.buttons["Use Apple models"].waitForExistence(timeout: 3))
      XCTAssertFalse(app.buttons["Stop recording"].exists)
      XCTAssertFalse(app.buttons["Set up English speech"].exists)
      app.buttons["Use Apple models"].tap()
      app.buttons["Settings"].tap()
      XCTAssertTrue(picker.waitForExistence(timeout: 5))
    } else {
      XCTAssertTrue(app.staticTexts["settings.modelStatus"].label.contains("are installed"))
      capture("local-models-custom-persisted-ready")
      picker.buttons["Apple"].tap()
    }
    XCTAssertTrue(picker.buttons["Apple"].isSelected)
  }

  func testSettingsAndBackupControls() {
    command("write x+6=8")
    app.buttons["Settings"].tap()
    revealSettingsData()
    XCTAssertTrue(app.buttons["Download backup"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Import backup"].exists)
    XCTAssertTrue(app.buttons["Save PDF"].exists)
    capture("settings-backup-and-export")
    app.buttons["Download backup"].tap()
    saveExport("backup-export-dialog")
    XCTAssertTrue(app.staticTexts["Export saved."].waitForExistence(timeout: 8))
    app.buttons["Import backup"].tap()
    let backupName = "Mathwave-test-" + app.launchEnvironment["MATH_AUDIO_UI_TEST_ID"]! + ".json"
    let backup = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", backupName))
      .firstMatch
    XCTAssertTrue(backup.waitForExistence(timeout: 8))
    backup.tap()
    XCTAssertTrue(
      app.staticTexts["Backup imported as independent problems."].waitForExistence(timeout: 8))
    XCTAssertEqual(
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Open ")).count, 2)
    capture("settings-backup-import-preserves-original")
    XCTAssertTrue(app.buttons["Save PDF"].waitForExistence(timeout: 5))
    app.buttons["Back to problem solving"].tap()
    XCTAssertTrue(app.buttons["Voice input"].exists)
  }

  private func revealSettingsData() {
    for _ in 0..<5 {
      if app.buttons["Download backup"].isHittable { return }
      app.scrollViews.firstMatch.swipeUp()
    }
  }

  func testSettingsLibrarySearchSortingAndPreferencePersistence() {
    command("write x+6=8")
    for _ in 0..<6 { command("new problem") }
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Past problems"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Show more"].exists)
    capture("settings-phone-library")
    app.buttons["Show more"].tap()
    XCTAssertTrue(app.buttons["Show less"].exists)
    app.buttons["Search problems"].tap()
    XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
    app.searchFields.firstMatch.tap()
    app.searchFields.firstMatch.typeText("no-such-problem")
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "No problems match"))
        .firstMatch.exists)
    capture("settings-search-empty")
    app.searchFields.firstMatch.buttons["Clear text"].tap()
    app.buttons["settings.sort"].tap()
    app.buttons["Name"].tap()
    XCTAssertTrue(app.staticTexts["7 problems"].exists)
    capture("settings-search-name")
    let download = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Export "))
      .firstMatch
    download.tap()
    XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 8))
    capture("settings-search-row-export")
    app.buttons["Save"].tap()
    XCTAssertTrue(app.buttons["settings.sort"].waitForExistence(timeout: 8))
    let trash = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Delete "))
      .firstMatch
    trash.tap()
    XCTAssertTrue(app.buttons["settings.confirmDelete"].waitForExistence(timeout: 5))
    capture("settings-search-row-delete")
    app.buttons["Cancel"].tap()
    trash.tap()
    app.buttons["settings.confirmDelete"].tap()
    XCTAssertTrue(app.staticTexts["6 problems"].waitForExistence(timeout: 8))
    // iOS hides page navigation while its search field is active.
    if !app.buttons["Done"].exists { app.buttons["close"].tap() }
    XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    revealSettingsData()
    let celebration = app.switches["settings.celebrations"]
    XCTAssertTrue(celebration.exists)
    celebration.tap()
    capture("settings-data-and-preferences")
    app.buttons["Back to problem solving"].tap()
    app.terminate()
    app.launch()
    openWorkspace()
    app.buttons["Settings"].tap()
    revealSettingsData()
    XCTAssertEqual(app.switches["settings.celebrations"].value as? String, "0")
  }

  func testSettingsLargeTextAppearance() {
    app.terminate()
    app.launchArguments += [
      "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
    ]
    app.launch()
    openWorkspace()
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Past problems"].waitForExistence(timeout: 5))
    capture("settings-large-text-top")
    revealSettingsData()
    XCTAssertTrue(app.buttons["Download backup"].isHittable)
    capture("settings-large-text-data")
    app.buttons["Back to problem solving"].tap()
    XCTAssertTrue(app.buttons["Voice input"].exists)
  }

  func testSettingsPortraitGraphicalPDF() {
    command("graph y=x^2")
    let originalGraph = graphCanvas.label
    app.buttons["Settings"].tap()
    revealSettingsData()
    app.buttons["Save PDF"].tap()
    // Export actions stay unavailable while a PDF is being prepared or presented.
    for label in ["Download backup", "Download text"] {
      if app.buttons[label].exists { XCTAssertFalse(app.buttons[label].isEnabled) }
    }
    saveExport("settings-portrait-pdf-dialog")
    XCTAssertTrue(app.staticTexts["settings.fileStatus"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["settings.fileStatus"].label, "Export saved.")
    capture("settings-portrait-pdf-saved")
    app.buttons["Back to problem solving"].tap()
    XCTAssertTrue(graphCanvas.waitForExistence(timeout: 10))
    XCTAssertEqual(graphCanvas.label, originalGraph)
  }

  func testSettingsTabletLayoutAndGraphicalPDF() {
    command("graph y=x^2")
    let originalGraph = graphCanvas.label
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["Back to problem solving"].waitForExistence(timeout: 5))
    capture("settings-portrait")
    XCUIDevice.shared.orientation = .landscapeLeft
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { [self] _, _ in
        let frame = app.windows.firstMatch.frame
        return frame.width > frame.height
      }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 8), .completed)
    Thread.sleep(forTimeInterval: 1)
    capture("settings-landscape")
    revealSettingsData()
    app.buttons["Save PDF"].tap()
    saveExport("settings-pdf-dialog")
    XCTAssertTrue(app.staticTexts["settings.fileStatus"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["settings.fileStatus"].label, "Export saved.")
    app.buttons["Back to problem solving"].tap()
    XCTAssertTrue(graphCanvas.waitForExistence(timeout: 10))
    XCTAssertEqual(graphCanvas.label, originalGraph)
  }

  func testCommandSheetDraftAndPanelNavigation() {
    openCommandEntry()
    if app.buttons["Use plain text"].exists { app.buttons["Use plain text"].tap() }
    input.tap()
    input.typeText("subtract three from")
    app.buttons["Done"].tap()
    openCommandEntry()
    XCTAssertEqual(input.value as? String, "subtract three from")
    app.buttons["Done"].tap()
    command("open voice settings")
    revealSettingsData()
    XCTAssertTrue(app.buttons["Download backup"].waitForExistence(timeout: 5))
    app.buttons["Back to problem solving"].tap()
    capture("worksheet-after-command-panel")
  }

  func testDeletingSavedProblemUsesNativeConfirmation() {
    command("write x+6=8")
    app.buttons["Settings"].tap()
    let deletion = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Delete "))
      .firstMatch
    XCTAssertTrue(deletion.waitForExistence(timeout: 5))
    deletion.tap()
    XCTAssertTrue(app.buttons["settings.confirmDelete"].waitForExistence(timeout: 5))
    capture("saved-problem-delete-confirmation")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(deletion.exists)
    app.buttons["Back to problem solving"].tap()
  }

  func testTabletAndPhoneOrientationLayout() {
    command("graph y=x^2")
    XCUIDevice.shared.orientation = .landscapeLeft
    waitForOrientation(landscape: true)
    capture("workspace-landscape")
    XCUIDevice.shared.orientation = .portrait
    waitForOrientation(landscape: false)
    capture("workspace-portrait")
  }

  private func waitForOrientation(landscape: Bool) {
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { [self] _, _ in
        let viewport = app.windows.firstMatch.frame
        return (viewport.width > viewport.height) == landscape
          && viewport.contains(app.buttons["Voice input"].frame)
      }, object: app)
    XCTAssertEqual(
      XCTWaiter.wait(for: [settled], timeout: 8), .completed,
      "Window \(app.windows.firstMatch.frame), voice \(app.buttons["Voice input"].frame), equation \(latestExpression.frame)"
    )
    // Short landscape windows scroll the worksheet beneath the fixed voice controls.
    if latestExpression.exists {
      latestExpression.tap()
      XCTAssertTrue(app.webViews.firstMatch.frame.contains(latestExpression.frame))
    } else {
      XCTAssertTrue(graphCanvas.waitForExistence(timeout: 5))
      XCTAssertTrue(app.webViews.firstMatch.frame.contains(graphCanvas.frame))
    }
    // Window geometry settles before the simulator finishes compositing a rotated screenshot.
    Thread.sleep(forTimeInterval: 1)
  }

  func testQuietDrawingAndAutomaticMathKeyboard() {
    command("graph y=x^2")
    XCTAssertFalse(app.buttons["Step actions"].exists)
    XCTAssertFalse(
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label == %@", "Graph expression 1")
      ).firstMatch.exists)
    XCTAssertTrue(
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label BEGINSWITH %@", "Graph. ")
      ).firstMatch.waitForExistence(timeout: 5))
    capture("quiet-graph")
    app.buttons["Explore work"].tap()
    app.buttons["Edit drawing"].tap()
    let field = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", "Graph expression 1")
    ).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    let seven = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "7"))
      .firstMatch
    XCTAssertTrue(seven.waitForExistence(timeout: 5))
    capture("automatic-graph-math-keyboard")
    app.buttons["Explore work"].tap()
    app.buttons["Show drawing only"].tap()
    command("right triangle with legs three and four")
    XCTAssertFalse(seven.exists)
    XCTAssertFalse(app.buttons["Double size"].exists)
    XCTAssertFalse(app.buttons["Math keyboard"].exists)
    XCTAssertFalse(app.staticTexts["Edit dimensions"].exists)
    capture("quiet-geometry")
  }

  func testBranchingRequiresHoldingAnEquation() {
    command("write x+1=3")
    let branch = app.buttons["Branch from step 1"]
    XCTAssertFalse(branch.exists)
    XCTAssertFalse(app.buttons["Step actions"].exists)
    latestExpression.tap()
    XCTAssertFalse(branch.exists)
    latestExpression.press(forDuration: 0.8)
    XCTAssertTrue(branch.waitForExistence(timeout: 5))
    capture("equation-hold-options")
    branch.tap()
    XCTAssertTrue(app.buttons["Save branch"].waitForExistence(timeout: 5))
    let seven = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "7"))
      .firstMatch
    XCTAssertTrue(seven.waitForExistence(timeout: 5))
    capture("automatic-branch-math-keyboard")
  }

  func testHoldingStepOptionsSurvivesUndo() {
    command("write x+2=5")
    command("subtract two from both sides")
    latestExpression.press(forDuration: 0.8)
    XCTAssertTrue(app.buttons["Branch from step 2"].waitForExistence(timeout: 5))
    app.buttons["Undo"].tap()
    XCTAssertTrue(app.buttons["Branch from step 2"].waitForNonExistence(timeout: 5))
    XCTAssertTrue(latestExpression.waitForExistence(timeout: 5))
    latestExpression.press(forDuration: 0.8)
    XCTAssertTrue(app.buttons["Branch from step 1"].waitForExistence(timeout: 5))
  }

  func testSavingOneCurvePreservesOtherUnfinishedEdits() {
    command("graph y=x^2")
    command("add graph y=2*x+3")
    app.buttons["Explore work"].tap()
    app.buttons["Edit drawing"].tap()
    app.webViews.firstMatch.swipeUp()
    let second = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", "Graph expression 2")
    ).firstMatch
    XCTAssertTrue(second.waitForExistence(timeout: 5))
    second.tap()
    let keys = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "("))
    XCTAssertTrue(keys.firstMatch.waitForExistence(timeout: 5))
    keys.element(boundBy: keys.count - 1).tap()
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "The last valid curve is still shown")
      ).firstMatch.waitForExistence(timeout: 5))
    capture("graph-unfinished-curve-before-other-save")
    // A command changes the other curve through the same native bridge as an inline save.
    command("edit graph 1 to 3")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label BEGINSWITH %@", "Focus step 3: 3")
      ).firstMatch
        .waitForExistence(timeout: 5))
    XCTAssertTrue(second.exists)
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "The last valid curve is still shown")
      ).firstMatch.exists)
    capture("graph-editor-preserves-unfinished-curve")
  }

  /// Records actual custom recognition and inference; no transcript or model answer is injected.
  func testCustomAudioAutomaticallyRunsWithoutCommandEntry() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let fixture = environment["MATHWAVE_VERIFICATION_AUDIO_PATH"], !fixture.isEmpty else {
      throw XCTSkip("Run Native/scripts/record-custom-models.py to stage the recorded audio fixture.")
    }
    app.terminate()
    for key in [
      "MATHWAVE_VERIFICATION_AUDIO_PATH", "MATHWAVE_VERIFICATION_EVENTS_PATH",
      "MATHWAVE_VERIFICATION_READBACK_PATH", "MATH_AUDIO_UI_TEST_ID",
    ] {
      if let value = environment[key] { app.launchEnvironment[key] = value }
    }
    // Exercise the installed-model default rather than the verification override.
    app.launchEnvironment["MATHWAVE_VERIFICATION_MODEL_MODE"] = ""
    app.launchEnvironment["MATHWAVE_TEST_COMMAND_ENTRY"] = "0"
    app.launch()
    openWorkspace()

    app.buttons["Settings"].tap()
    let custom = app.segmentedControls["settings.modelMode"].buttons["Custom"]
    XCTAssertTrue(custom.waitForExistence(timeout: 10))
    XCTAssertTrue(custom.isSelected)
    let spoken = app.switches["settings.spoken"]
    XCTAssertTrue(spoken.exists)
    if spoken.value as? String != "1" { spoken.tap() }
    capture("custom-models-settings")
    app.buttons["Back to problem solving"].tap()

    app.buttons["Voice input"].tap()
    XCTAssertFalse(app.buttons["Run command"].exists)
    XCTAssertFalse(input.exists)
    let expected = environment["MATHWAVE_VERIFICATION_EXPECTED_EXPRESSION"]
      ?? "2 * x + 3 * x - 4 = 11"
    let result = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Focus step ", expected)
    ).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: 180), app.debugDescription)
    XCTAssertFalse(app.buttons["Run command"].exists)
    XCTAssertFalse(input.exists)
    XCTAssertTrue(app.staticTexts["voice.transcript"].exists)
    // Keep the rendered result and automatic readback visible; the host checks actual synthesis.
    Thread.sleep(forTimeInterval: 6)
    capture("audio-command-result-and-readback")

  }

}
