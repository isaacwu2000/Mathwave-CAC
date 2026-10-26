import Foundation
import Testing

@testable import MathAudioCore

struct SharedWorkbenchTests {
  @Test func spokenGraphCreationProducesAnEditableParabola() throws {
    let engine = try SharedWorkbench()
    let graph = try engine.perform("submit", text: "Create a graph of Y equals X squared")
    #expect(graph.graphRows.first == "y = x^2")
    #expect(graph.plot?.plots.isEmpty == false)
  }

  @Test func structuredRevisionPreservesTheLaterBranchAndDraft() throws {
    let engine = try SharedWorkbench()
    let written = try engine.perform("command", text: "write 2*x=8")
    let solved = try engine.perform("command", library: written.library, text: "solve")
    let draft = try engine.perform("draft", library: solved.library, text: "unfinished command")
    let revised = try engine.perform("revise", library: draft.library, text: "2*x=10", index: 1)
    #expect(revised.expression == "2 * x = 10")
    #expect(revised.draft == "unfinished command")
    #expect(!revised.branches.isEmpty)
    #expect(throws: (any Error).self) {
      try engine.perform("revise", library: draft.library, text: "new problem", index: 1)
    }
  }

  @Test func localExportCommandsPreserveWork() throws {
    let engine = try SharedWorkbench()
    let written = try engine.perform("command", text: "write x+2=7")
    for command in [
      "export", "export work", "export problem", "export notebook", "print", "save pdf",
      "export pdf",
    ] {
      let result = try engine.perform("command", library: written.library, text: command)
      #expect(result.action == (command.contains("pdf") || command == "print" ? "print" : "export"))
      #expect(result.library == written.library)
    }
  }

  @Test func algebraUsesWebCommandsWithoutUnsolicitedSolving() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    let written = try engine.perform(
      "command", library: blank.library, text: "write two x plus three equals eleven")
    #expect(written.expression == "2 * x + 3 = 11")
    #expect(written.steps.count == 1)
    #expect(written.steps.first?.expression == "2 * x + 3 = 11")
    #expect(written.steps.first?.equations.first?.notation?.kind == "equation")
    #expect(written.steps.first?.equations.first?.notation?.right?.value == 11)
    let moved = try engine.perform(
      "command", library: written.library, text: "subtract three from both sides")
    let divided = try engine.perform(
      "command", library: moved.library, text: "divide both sides by two")
    let solved = try engine.perform("command", library: divided.library, text: "simplify")
    #expect(solved.expression == "x = 4")
    #expect(solved.steps.first?.expression == "2 * x + 3 = 11")
    let undone = try engine.perform("command", library: solved.library, text: "undo")
    #expect(undone.expression != solved.expression)
    let redone = try engine.perform("command", library: undone.library, text: "redo")
    #expect(redone.expression == "x = 4")
  }

  @Test func exportingAnotherProblemDoesNotSwitchOrConsumeDrafts() throws {
    let engine = try SharedWorkbench()
    let first = try engine.perform("command", text: "write x+6=8")
    let second = try engine.perform("new", library: first.library, text: "Second problem")
    let draft = try engine.perform("draft", library: second.library, text: "subtract three from")
    let exported = try engine.perform(
      "export-problem", library: draft.library, text: first.problemId)
    #expect(exported.problemId == second.problemId)
    #expect(exported.library == draft.library)
    #expect(exported.draft == "subtract three from")
    #expect(exported.exportText.contains("x + 6 = 8"))
    #expect(!exported.exportText.contains("Second problem"))
  }

  @Test func celebrationsOnlyFollowVerifiedWorkAndNeverHistoryVisits() throws {
    let engine = try SharedWorkbench()
    let written = try engine.perform("command", text: "write 2*x+3=11")
    #expect(written.completion == nil)
    let moved = try engine.perform(
      "command", library: written.library, text: "subtract three from both sides")
    #expect(moved.completion == nil)
    let divided = try engine.perform(
      "command", library: moved.library, text: "divide both sides by two")
    let finished = try engine.perform("command", library: divided.library, text: "simplify")
    #expect(finished.completion == "x = 4")
    let undone = try engine.perform("command", library: finished.library, text: "undo")
    #expect(undone.completion == nil)
    #expect(try engine.perform("command", library: undone.library, text: "redo").completion == nil)
    #expect(try engine.perform("open", library: finished.library).completion == nil)
    #expect(
      try engine.perform("command", library: written.library, text: "write x=7").completion == nil)
  }

  @Test func graphsGeometryAndStatisticsUseTheSameEngine() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    let graph = try engine.perform(
      "command", library: blank.library, text: "graph y equals x squared")
    #expect(graph.plot?.plots.isEmpty == false)
    let collection = try engine.perform(
      "command", library: graph.library, text: "add graph y=2*x+3")
    #expect(collection.steps.last?.equations.map(\.expression) == ["y = x^2", "y = 2 * x + 3"])
    let integral = try engine.perform(
      "command", library: graph.library, text: "integral graph one from zero to three")
    #expect(integral.message.contains("9"))
    #expect(integral.steps.count == graph.steps.count)
    let shape = try engine.perform(
      "command", library: graph.library, text: "right triangle with legs three and four")
    let hypotenuse = try engine.perform(
      "command", library: shape.library, text: "find its hypotenuse")
    #expect(hypotenuse.message.contains("5"))
    #expect(shape.plot?.plots.isEmpty == false)
    let data = try engine.perform("command", library: shape.library, text: "data 4, 8, 10, 14")
    let mean = try engine.perform("command", library: data.library, text: "mean")
    #expect(mean.message.contains("9"))
    #expect(mean.mode == "statistics")
  }

  @Test func backupsAndDraftsSurviveReopeningAndInvalidInput() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    let written = try engine.perform("command", library: blank.library, text: "write x + 6 = 8")
    let draft = try engine.perform("draft", library: written.library, text: "replace six with")
    let reopened = try engine.perform("open", library: draft.library)
    #expect(reopened.draft == "replace six with")
    #expect(throws: (any Error).self) {
      try engine.perform("command", library: reopened.library, text: "replace six with")
    }
    let imported = try engine.perform("import", library: blank.library, text: reopened.library)
    #expect(imported.problems.count == 2)
    #expect(throws: (any Error).self) {
      try engine.perform("import", library: written.library, text: "{}")
    }
    #expect(try engine.perform("open", library: written.library).expression == written.expression)
  }

  @Test func graphToolbarAndHistoryPreserveUnfinishedDrafts() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    let graph = try engine.perform("command", library: blank.library, text: "graph y=x^2")
    let draft = try engine.perform("draft", library: graph.library, text: "write x squared plus")
    for command in ["fit graph", "play graph", "pan left", "trace graph one at x two", "undo"] {
      let next = try engine.perform("command", library: draft.library, text: command)
      #expect(next.draft == "write x squared plus")
    }
    let traced = try engine.perform(
      "command", library: graph.library, text: "trace graph one at x two")
    #expect(traced.plot?.plots.first(where: { $0.id == "trace" })?.positions == [2, 4, 0])
    let matchingDraft = try engine.perform("draft", library: graph.library, text: "fit graph")
    let toolbar = try engine.perform("command", library: matchingDraft.library, text: "fit graph")
    #expect(toolbar.draft == "fit graph")
  }

  @Test func graphCollectionsAndProgramBackupsReplayOffline() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    let scene = try engine.perform("command", library: blank.library, text: "graph x^2+y^2=25")
    #expect(scene.plot?.plots.isEmpty == false)
    #expect(scene.renderWarning == nil)
    #expect(try engine.perform("open", library: scene.library).plot?.plots.isEmpty == false)
    let equation = try engine.perform("command", library: blank.library, text: "write 2*x+3=11")
    let program = try engine.perform(
      "command", library: equation.library,
      text:
        "typescript\nproblem.save(math.simplify(math.subtractBothSides(problem.currentEquation(), 3)));"
    )
    #expect(program.expression == "2 * x = 8")
    #expect(try engine.perform("open", library: program.library).expression == "2 * x = 8")
  }

  @Test func importedInteractiveExplanationRetainsAdjustableValues() throws {
    let engine = try SharedWorkbench()
    let blank = try engine.perform("open")
    var book = try JSONSerialization.jsonObject(with: Data(blank.library.utf8)) as! [String: Any]
    var assignments = book["assignments"] as! [[String: Any]]
    var problems = assignments[0]["problems"] as! [[String: Any]]
    problems[0]["exploration"] =
      [
        "title": "Curve coefficient",
        "description": "Change the coefficient and compare the curves.",
        "controls": [
          ["name": "a", "label": "Coefficient", "min": -3, "max": 3, "step": 0.5, "value": 1]
        ],
        "plots": ["y=a*x^2"], "readouts": [["label": "Height at x two", "expression": "a*2^2"]],
        "xRange": ["min": -5, "max": 5], "yRange": ["min": -10, "max": 10],
      ] as [String: Any]
    assignments[0]["problems"] = problems
    book["assignments"] = assignments
    let raw = String(decoding: try JSONSerialization.data(withJSONObject: book), as: UTF8.self)
    let opened = try engine.perform("open", library: raw)
    #expect(opened.explanation?.readouts.first?.value == "4")
    let adjusted = try engine.perform("adjust", library: opened.library, text: "a", index: -2)
    #expect(adjusted.explanation?.readouts.first?.value == "-8")
    #expect(adjusted.steps.isEmpty)
    #expect(
      try engine.perform("open", library: adjusted.library).explanation?.readouts.first?.value
        == "-8")
  }
}

struct LocalAgentTests {
  @Test @MainActor func cancellingTheAgentCancelsItsInferenceTask() async throws {
    let engine = try SharedWorkbench()
    var started = false
    var observedCancellation = false
    let operation = Task { @MainActor in
      try await engine.runAgent("Please carry out the adjustment we discussed.") { _ in
        started = true
        do { try await Task.sleep(nanoseconds: 5_000_000_000) }
        catch { observedCancellation = Task.isCancelled; throw error }
        return #"{"answer":{"status":"reply","programs":[],"message":"No change.","presentation":null}}"#
      }
    }
    while !started { await Task.yield() }
    operation.cancel()
    do { _ = try await operation.value; Issue.record("Cancelled inference returned a result") }
    catch { #expect(error is CancellationError) }
    await Task.yield()
    #expect(observedCancellation)
  }

  @Test @MainActor func localAgentPreviewsAreReadOnlyAcrossTheNativeBridge() async throws {
    let engine = try SharedWorkbench()
    let initial = try engine.perform("command", text: "data 2,4,9")
    let result = try await engine.runAgent(
      "Explain the mean of this list without changing it.", library: initial.library
    ) { raw in
      let request = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as! [String: Any]
      let input = request["input"] as! [[String: Any]]
      if input.count == 1 {
        return #"{"calls":[{"id":"mean","name":"preview_math","arguments":"{\"program\":\"statistics.mean(statistics.current());\",\"programs\":[]}"}]}"#
      }
      let observation = input.last?["output"] as! String
      #expect(observation.contains("5"))
      #expect(observation.contains("applied"))
      return #"{"answer":{"status":"explanation","programs":[],"message":"The mean is 5.","presentation":null}}"#
    }
    #expect(result.status == "explanation")
    #expect(result.document.message == "The mean is 5.")
    #expect(result.document.steps.count == 1)
    #expect(result.document.data == [2, 4, 9])
  }

  @Test @MainActor func localAgentExecutesACompactDSLResponseThroughTheNativeBridge() async throws {
    let engine = try SharedWorkbench()
    let initial = try engine.perform("command", text: "write 2*x+3=11")
    let result = try await engine.runAgent(
      "Take away three, then simplify the result.", library: initial.library
    ) { request in
      #expect(request.contains("programs"))
      return #"{"answer":{"status":"command","programs":["problem.save(math.subtractBothSides(problem.currentEquation(),3));","problem.save(math.simplify(problem.currentEquation()));"],"message":"","presentation":null}}"#
    }
    #expect(result.document.expression == "2 * x = 8")
    #expect(result.document.steps.count == 3)
    #expect(result.status == "command")
    #expect(try engine.perform("open", library: initial.library).expression == "2 * x + 3 = 11")
  }
}
