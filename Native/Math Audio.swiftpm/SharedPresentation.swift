import SwiftUI
import WebKit

#if canImport(MathAudioCore)
  import MathAudioCore
#endif

/// Loads only packaged presentation assets. Native retains the library and authorizes every edit.
struct SharedPresentation: View {
  @ObservedObject var model: WorkbenchModel
  var showControls = false
  var composing = false
  var fillsSpace = false
  var onFocus: (Int) -> Void = { _ in }
  @State private var height: CGFloat = 500
  @State private var ready = false
  @Environment(\.sizeCategory) private var sizeCategory
  @Environment(\.colorScheme) private var colorScheme
  // Match the system text-size progression rather than flattening ordinary sizes.
  private var textScale: Double {
    switch sizeCategory {
    case .extraSmall: return 14.0 / 17
    case .small: return 15.0 / 17
    case .medium: return 16.0 / 17
    case .large: return 1
    case .extraLarge: return 19.0 / 17
    case .extraExtraLarge: return 21.0 / 17
    case .extraExtraExtraLarge: return 23.0 / 17
    case .accessibilityMedium: return 28.0 / 17
    case .accessibilityLarge: return 33.0 / 17
    case .accessibilityExtraLarge: return 40.0 / 17
    case .accessibilityExtraExtraLarge: return 47.0 / 17
    case .accessibilityExtraExtraExtraLarge: return 53.0 / 17
    @unknown default: return 1
    }
  }

  var body: some View {
    PresentationWebView(
      model: model, composing: composing, showControls: showControls,
      scale: textScale,
      dark: colorScheme == .dark, onReady: { ready = true }, onFocus: onFocus,
      onHeight: { height = max(120, min(6000, $0)) }
    )
    .frame(maxWidth: .infinity, maxHeight: fillsSpace ? .infinity : nil)
    .frame(height: fillsSpace ? nil : composing ? min(400, height) : height)
    .overlay {
      if !ready {
        ProgressView("Opening your work…").accessibilityIdentifier("presentation.loading")
      }
    }
    .onChange(of: model.document?.library) { _ in ready = false }
  }
}

#if os(iOS)
  private struct PresentationWebView: UIViewRepresentable {
    let model: WorkbenchModel
    let composing: Bool
    let showControls: Bool
    let scale: Double
    let dark: Bool
    let onReady: () -> Void
    let onFocus: (Int) -> Void
    let onHeight: (CGFloat) -> Void
    func makeCoordinator() -> PresentationCoordinator {
      PresentationCoordinator(model: model, onReady: onReady, onFocus: onFocus, onHeight: onHeight)
    }
    func makeUIView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateUIView(_ view: WKWebView, context: Context) {
      context.coordinator.update(
        composing: composing, showControls: showControls, scale: scale, dark: dark)
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: PresentationCoordinator) {
      coordinator.dispose()
    }
  }
#else
  private struct PresentationWebView: NSViewRepresentable {
    let model: WorkbenchModel
    let composing: Bool
    let showControls: Bool
    let scale: Double
    let dark: Bool
    let onReady: () -> Void
    let onFocus: (Int) -> Void
    let onHeight: (CGFloat) -> Void
    func makeCoordinator() -> PresentationCoordinator {
      PresentationCoordinator(model: model, onReady: onReady, onFocus: onFocus, onHeight: onHeight)
    }
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateNSView(_ view: WKWebView, context: Context) {
      context.coordinator.update(
        composing: composing, showControls: showControls, scale: scale, dark: dark)
    }
    static func dismantleNSView(_ view: WKWebView, coordinator: PresentationCoordinator) {
      coordinator.dispose()
    }
  }
#endif

@MainActor
private final class PresentationCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate
{
  private weak var model: WorkbenchModel?
  private weak var webView: WKWebView?
  private let onReady: () -> Void
  private let onFocus: (Int) -> Void
  private let onHeight: (CGFloat) -> Void
  private var ready = false
  private var assetURL: URL?
  private var reloads = 0
  private var payload = ""
  private var content = ""
  private var renderID = 0
  private var sent = ""
  init(
    model: WorkbenchModel, onReady: @escaping () -> Void, onFocus: @escaping (Int) -> Void,
    onHeight: @escaping (CGFloat) -> Void
  ) {
    self.model = model
    self.onReady = onReady
    self.onFocus = onFocus
    self.onHeight = onHeight
  }
  func makeView() -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(self, name: "mathwave")
    config.userContentController.addUserScript(
      WKUserScript(
        source:
          "window.addEventListener('error',e=>window.webkit.messageHandlers.mathwave.postMessage({operation:'display-error',message:e.message||'A packaged resource failed to load.'}),true);document.addEventListener('securitypolicyviolation',e=>window.webkit.messageHandlers.mathwave.postMessage({operation:'display-error',message:e.violatedDirective+': '+e.blockedURI}));",
        injectionTime: .atDocumentStart, forMainFrameOnly: true))

    let view = WKWebView(frame: .zero, configuration: config)
    webView = view
    view.navigationDelegate = self
    #if os(iOS)
      view.isOpaque = false
      view.backgroundColor = .clear
      view.scrollView.isScrollEnabled = true
    #endif
    #if SWIFT_PACKAGE
      let bundle = Bundle.module
    #else
      let bundle = Bundle.main
    #endif
    if let folder = bundle.url(forResource: "Presentation", withExtension: nil),
      FileManager.default.fileExists(atPath: folder.appendingPathComponent("index.html").path)
    {
      assetURL = folder.appendingPathComponent("index.html")
      view.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
    } else {
      view.loadHTMLString(
        "<p>Math display could not load. Your saved work is safe. Rebuild the app with its bundled presentation resources.</p>",
        baseURL: nil)
    }
    return view
  }
  func dispose() {
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "mathwave")
    webView?.stopLoading()
  }
  func update(composing: Bool, showControls: Bool, scale: Double, dark: Bool) {
    guard let model, let library = model.document?.library else { return }
    var value: [String: Any] = [
      "library": library, "draft": model.draft, "mode": composing ? "composer" : "workspace",
      "scale": scale, "dark": dark, "showControls": showControls,
      "revisionDrafts": model.revisionDrafts,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    else { return }
    let next = data.base64EncodedString()
    guard next != content else { return }
    content = next
    renderID += 1
    value["renderID"] = renderID
    guard let updated = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    else { return }
    payload = updated.base64EncodedString()
    publish()
  }
  private func publish() {
    guard ready, !payload.isEmpty, payload != sent else { return }
    let current = payload
    webView?.evaluateJavaScript("window.Mathwave.receive('\(current)')") { [weak self] _, error in
      if let error {
        #if DEBUG
          NSLog("Mathwave snapshot error: %@", error.localizedDescription)
        #endif
      } else {
        self?.sent = current
      }
    }
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, let value = message.body as? [String: Any],
      let operation = value["operation"] as? String
    else { return }
    if operation == "display-error" {
      #if DEBUG
        NSLog(
          "Mathwave presentation error: %@", value["message"] as? String ?? "Unknown display error")
      #endif
      model?.message =
        "Math display could not load. Your saved work is safe. Reopen your problem to retry."
      return
    }
    if operation == "rendered", value["renderID"] as? Int == renderID {
      onReady()
      return
    }
    if operation == "ready" {
      ready = true
      publish()
      return
    }
    if operation == "height", let height = value["height"] as? Double, height.isFinite {
      onHeight(CGFloat(height))
      return
    }
    if operation == "focus", value["problemId"] as? String == model?.document?.problemId,
      let step = value["step"] as? Int
    {
      onFocus(step)
      return
    }
    guard let id = value["id"] as? Int, let model else { return }
    let text = value["text"] as? String ?? ""
    let index = value["index"] as? Double ?? 0
    var ok = false
    if text.count <= 10_000, index.isFinite,
      value["problemId"] as? String == model.document?.problemId
    {
      switch operation {
      case "command", "revise", "branch", "adjust", "dismiss-explanation":
        if text.count <= 4_000 { ok = model.perform(operation, text: text, index: index) }
      case "read":
        model.audio.speak(text)
        ok = true
      case "revision-draft":
        if let data = text.data(using: .utf8),
          let draft = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let key = draft["key"], key == "mathwave-revision:" + (model.document?.problemId ?? "")
        {
          model.revisionDrafts[key] = draft["value"]
          ok = true
        }
      case "draft":
        model.draft = text
        model.scheduleDraftSave()
        ok = true
      case "listen":
        Task { await model.audio.toggleListening() }
        ok = true
      default: break
      }
    }
    if ok, operation == "command", value["readResult"] as? Bool == true, !model.readAutomatically {
      model.audio.speak(model.message)
    }
    let errorData = try? JSONSerialization.data(withJSONObject: [ok ? "" : model.message])
    let error =
      errorData.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"The action could not run.\"]"
    webView?.evaluateJavaScript(
      "window.Mathwave.resolve(\(id), \(ok ? "true" : "false"), \(error)[0])")
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    ready = false
    sent = ""
    reloads += 1
    if reloads <= 2 { webView.reload() } else { showFailure(webView) }
  }
  private func showFailure(_ webView: WKWebView) {
    ready = false
    sent = ""
    let retry =
      assetURL.map { "<a href=\"\($0.absoluteString)\">Retry math display</a>" }
      ?? "Rebuild the app with its presentation resources."
    webView.loadHTMLString(
      "<meta name=\"viewport\" content=\"width=device-width\"><p>Math display could not load. Your work is saved locally.</p>\(retry)",
      baseURL: nil)
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showFailure(webView)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { showFailure(webView) }
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    // Packaged files only: no links, hosted pages, account cookies, or online fallback.
    decisionHandler(
      (navigationAction.request.url?.isFileURL == true
        || navigationAction.request.url?.absoluteString == "about:blank") ? .allow : .cancel)
  }
}

#if os(iOS)
  import PDFKit

  /// Renders the shared mathematical notation for printing, then appends the native vector drawing.
  @MainActor
  final class SharedPresentationPDF: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private var view: WKWebView?
    private var continuation: CheckedContinuation<Data, Error>?
    private var timeout: Task<Void, Never>?
    private let snapshot: String
    private let drawing: Data?
    init(library: String, draft: String, plot: WorkbenchPlot?) throws {
      let value: [String: Any] = [
        "library": library, "draft": draft, "mode": "export", "scale": 1, "dark": false,
        "revisionDrafts": [:],
      ]
      snapshot = try JSONSerialization.data(withJSONObject: value).base64EncodedString()
      drawing = try plot.map { try WorkPDF.make("", plot: $0) }
    }
    func make() async throws -> Data {
      return try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "mathwave")
        let web = WKWebView(
          frame: CGRect(x: 0, y: 0, width: 516, height: 696), configuration: config)
        web.navigationDelegate = self
        view = web
        // WebKit schedules visible-page work reliably when the export view is attached.
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
          .first,
          let window = scene.windows.first(where: { $0.isKeyWindow })
        {
          web.alpha = 0.01
          web.isUserInteractionEnabled = false
          web.accessibilityElementsHidden = true
          window.insertSubview(web, at: 0)
        }
        #if SWIFT_PACKAGE
          let bundle = Bundle.module
        #else
          let bundle = Bundle.main
        #endif
        guard let folder = bundle.url(forResource: "Presentation", withExtension: nil) else {
          finish(.failure(WorkbenchFailure("The bundled math display is missing.")))
          return
        }
        web.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
        timeout = Task { [weak self] in
          try? await Task.sleep(nanoseconds: 15_000_000_000)
          guard !Task.isCancelled else { return }
          self?.finish(
            .failure(WorkbenchFailure("The math display did not finish. Retry the PDF export.")))
        }
      }
    }
    func userContentController(
      _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
      guard message.frameInfo.isMainFrame, let value = message.body as? [String: Any],
        let operation = value["operation"] as? String, let view
      else { return }
      if operation == "ready" {
        view.evaluateJavaScript("window.Mathwave.receive('\(snapshot)')")
        return
      }
      guard operation == "export-ready" else { return }
      let renderer = UIPrintPageRenderer()
      let paper = CGRect(x: 0, y: 0, width: 612, height: 792)
      renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
      renderer.setValue(NSValue(cgRect: paper.insetBy(dx: 48, dy: 48)), forKey: "printableRect")
      renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
      let output = NSMutableData()
      UIGraphicsBeginPDFContextToData(output, paper, nil)
      for page in 0..<renderer.numberOfPages {
        UIGraphicsBeginPDFPage()
        renderer.drawPage(at: page, in: paper)
      }
      UIGraphicsEndPDFContext()
      guard let pdf = PDFDocument(data: output as Data), pdf.pageCount > 0 else {
        finish(.failure(WorkbenchFailure("The PDF could not be rendered. Retry export.")))
        return
      }
      if let drawing, let pages = PDFDocument(data: drawing) {
        for i in 0..<pages.pageCount {
          if let page = pages.page(at: i) { pdf.insert(page, at: pdf.pageCount) }
        }
      }
      guard let data = pdf.dataRepresentation() else {
        finish(.failure(WorkbenchFailure("The PDF could not be saved.")))
        return
      }
      finish(.success(data))
    }
    private func finish(_ result: Result<Data, Error>) {
      timeout?.cancel()
      timeout = nil
      view?.configuration.userContentController.removeScriptMessageHandler(forName: "mathwave")
      view?.stopLoading()
      view?.removeFromSuperview()
      view = nil
      let callback = continuation
      continuation = nil
      callback?.resume(with: result)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      finish(.failure(error))
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      finish(.failure(WorkbenchFailure("The PDF display stopped. Retry export.")))
    }
    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) { decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel) }
  }
#endif
