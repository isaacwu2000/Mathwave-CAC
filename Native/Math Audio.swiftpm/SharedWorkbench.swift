import Foundation
import JavaScriptCore

public struct WorkbenchDocument: Decodable {
    public let library: String
    public let title: String
    public let problemId: String
    public let mode: String
    public let expression: String
    public let draft: String
    public let selection: Int
    public let graphRows: [String]
    public let description: String
    public let message: String
    public let action: String?
    public let audio: [Double?]
    public let data: [Double]
    public let parts: [WorkbenchPart]
    public let steps: [WorkbenchStep]
    public let problems: [SavedProblem]
    public let branches: [WorkbenchBranch]
    public let canUndo: Bool
    public let canRedo: Bool
    public let libraryText: String
    public let completion: String?
    public let exportText: String
    public let plot: WorkbenchPlot?
    public let renderWarning: String?
    public let explanation: WorkbenchExplanation?
}
public struct WorkbenchExplanation: Decodable {
    public let title: String
    public let description: String
    public let controls: [ExplanationControl]
    public let readouts: [ExplanationReadout]
    public let plot: WorkbenchPlot
}
public struct ExplanationControl: Decodable, Identifiable {
    public let name: String
    public let label: String
    public let min: Double
    public let max: Double
    public let step: Double
    public let value: Double
    public var id: String { name }
}
public struct ExplanationReadout: Decodable {
    public let label: String
    public let expression: String
    public let value: String
}
public struct WorkbenchPart: Decodable, Identifiable {
    public let id: String
    public let label: String
    public let spoken: String
}
public struct WorkbenchStep: Decodable, Identifiable {
    public let equations: [WorkbenchEquation]
    public let expression: String?
    public let number: Int
    public let command: String
    public let description: String
    public var id: Int { number }
}
public struct WorkbenchEquation: Decodable {
    public let expression: String
    public let notation: WorkbenchNotation?
}

/// The web parser's expression tree, used only to lay out native mathematical notation.
public final class WorkbenchNotation: Decodable {
    public let kind: String
    public let value: Double?
    public let name: String?
    public let op: String?
    public let left: WorkbenchNotation?
    public let right: WorkbenchNotation?
    public let operand: WorkbenchNotation?
    public let argument: WorkbenchNotation?
}
public struct WorkbenchBranch: Decodable, Identifiable {
    public let number: Int
    public let command: String
    public var id: Int { number }
}
public struct SavedProblem: Decodable, Identifiable {
    public let id: String
    public let title: String
    public let assignment: String
    public let steps: Int
    public let at: String
}
public struct PlotRange: Decodable {
    public let min: Double
    public let max: Double
    public init(min: Double, max: Double) { self.min = min; self.max = max }
}
public struct PlotBounds: Decodable {
    public let min: Double
    public let max: Double
    public let y: PlotRange?
}
public struct PlotPrimitive: Decodable, Identifiable {
    public let id: String
    public let kind: String
    public let color: String
    public let positions: [Double]
    public let opacity: Double?
}
public struct PlotLabel: Decodable {
    public let text: String
    public let position: [Double]
}
public struct WorkbenchPlot: Decodable {
    public let bounds: PlotBounds
    public let plots: [PlotPrimitive]
    public let labels: [PlotLabel]
    public let axes: Bool
}

public struct WorkbenchFailure: LocalizedError {
    public let errorDescription: String?
    public init(_ message: String) { errorDescription = message }
}

public struct LocalAgentOutcome: Decodable {
    public let document: WorkbenchDocument
    public let status: String
    public let clarificationJSON: String?
}

/// Owns one native inference call so completion and cancellation can resume it only once.
@MainActor private final class LocalAgentCall {
    var continuation: CheckedContinuation<String, Error>?
    var inference: Task<Void, Never>?
    var deadline: Task<Void, Never>?

    func finish(_ result: Result<String, Error>) {
        guard let pending = continuation else { return }
        continuation = nil
        inference = nil
        deadline?.cancel()
        deadline = nil
        pending.resume(with: result)
    }

    func cancel() {
        inference?.cancel()
        finish(.failure(CancellationError()))
    }
}

/// Runs the web's bundled deterministic engines in an isolated, offline JavaScript context.
/// Call from one thread. Commands return a replacement document only after validation succeeds.
public final class SharedWorkbench {
    private let context: JSContext
    private let handle: JSValue

    public init() throws {
        guard let context = JSContext() else { throw WorkbenchFailure("The local math engine could not start.") }
        self.context = context
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        context.setObject(uuid, forKeyedSubscript: "nativeUUID" as NSString)
        // Shared previews clone JSON-only workspace values; JavaScriptCore lacks this browser helper.
        context.evaluateScript("globalThis.crypto = { randomUUID: nativeUUID }; globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));")
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource: "workbench", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw WorkbenchFailure("The local math engine is missing. Rebuild the app with its bundled resources.")
        }
        context.evaluateScript(source, withSourceURL: url)
        if let exception = context.exception { throw WorkbenchFailure(exception.toString() ?? "The math engine could not load.") }
        guard let function = context.objectForKeyedSubscript("MathAudioEngine")?.objectForKeyedSubscript("handle"), !function.isUndefined else {
            throw WorkbenchFailure("The math engine is unavailable.")
        }
        handle = function
    }

    /// Applies one local operation to a validated web-compatible backup.
    /// Invalid input throws without replacing or mutating the caller's saved library.
    public func perform(_ operation: String, library: String? = nil, text: String = "", index: Double = 0) throws -> WorkbenchDocument {
        struct Request: Encodable { let operation: String; let library: String?; let text: String; let index: Double }
        struct Response: Decodable { let ok: Bool; let value: WorkbenchDocument?; let error: String? }
        let request = Request(operation: operation, library: library, text: text, index: index)
        let raw = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
        context.exception = nil
        guard let result = handle.call(withArguments: [raw])?.toString(), let data = result.data(using: .utf8) else {
            throw WorkbenchFailure("The command could not run. Your work is unchanged.")
        }
        if let exception = context.exception { throw WorkbenchFailure(exception.toString() ?? "The math engine stopped.") }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.ok, let document = response.value else { throw WorkbenchFailure(response.error ?? "Your work is unchanged.") }
        return document
    }

    /// Runs a local model using the web's DSL and tool loop, without saving automatically.
    /// - The model receives JSON instructions/context/tools and returns an answer or preview calls.
    /// - The caller supplies cancellation-aware inference and adopts the result only if its library is still current.
    /// - Run on the main actor; errors and cancellation leave the caller's library unchanged.
    @MainActor public func runAgent(
        _ text: String, library: String? = nil, clarificationJSON: String? = nil,
        model: @escaping @MainActor (String) async throws -> String
    ) async throws -> LocalAgentOutcome {
        try Task.checkCancellation()
        var request: [String: Any] = ["text": text]
        if let library { request["library"] = library }
        if let clarificationJSON {
            request["clarification"] = try JSONSerialization.jsonObject(with: Data(clarificationJSON.utf8))
        }
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
        guard let function = context.objectForKeyedSubscript("MathAudioEngine")?.objectForKeyedSubscript("handleAgent"), !function.isUndefined else {
            throw WorkbenchFailure("The local agent harness is unavailable.")
        }
        let call = LocalAgentCall()
        let result: String = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                call.continuation = continuation
                if Task.isCancelled { call.cancel(); return }
                call.deadline = Task { @MainActor in
                    do { try await Task.sleep(nanoseconds: 40_000_000_000) }
                    catch { return }
                    call.inference?.cancel()
                    call.finish(.failure(WorkbenchFailure("Local interpretation timed out. Your work is unchanged.")))
                }
                let infer: @convention(block) (String, JSValue, JSValue) -> Void = { input, resolve, reject in
                    guard call.continuation != nil else {
                        _ = reject.call(withArguments: ["Local inference cancelled."])
                        return
                    }
                    call.inference = Task { @MainActor in
                        do {
                            try Task.checkCancellation()
                            let response = try await model(input)
                            try Task.checkCancellation()
                            _ = resolve.call(withArguments: [response])
                        } catch {
                            _ = reject.call(withArguments: [error.localizedDescription])
                        }
                    }
                }
                let complete: @convention(block) (String) -> Void = { response in
                    call.finish(.success(response))
                }
                context.exception = nil
                _ = function.call(withArguments: [raw, infer, complete])
            }
        } onCancel: {
            Task { @MainActor in call.cancel() }
        }
        try Task.checkCancellation()
        struct Response: Decodable { let ok: Bool; let value: LocalAgentOutcome?; let error: String? }
        let response = try JSONDecoder().decode(Response.self, from: Data(result.utf8))
        guard response.ok, let outcome = response.value else {
            throw WorkbenchFailure(response.error ?? "The local model could not complete this request.")
        }
        return outcome
    }
}
