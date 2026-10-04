#if DEBUG
import Foundation

/// Isolated native UI transport fixture. Never installed in a production
/// session and never registered globally with URLProtocol.
enum ToolOutputPreview {
    static func sessionIfRequested() -> URLSession? {
        guard ProcessInfo.processInfo.arguments.contains("--ui-preview-tool-output") else { return nil }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.protocolClasses = [ToolOutputPreviewProtocol.self]
        return URLSession(configuration: config)
    }
}

private final class ToolOutputPreviewProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "tool-output-preview.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let toolId = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "toolId" })?.value
        let otherConversation = url.path == "/api/chat/conversation/different-conversation/tool-output"
        let correctPath = url.path == "/api/chat/conversation/ui-preview-tool-activity/tool-output" || otherConversation
        let status = correctPath && toolId == "a" ? 200 : correctPath && toolId == "b" ? 403 : 404
        let payload: [String: Any] = status == 200
            ? ["ok": true, "output": otherConversation ? "WRONG_CONVERSATION_OUTPUT" : "NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."]
            : ["ok": false, "error": "PRIVATE_ERROR_BODY_MUST_NOT_DISPLAY"]
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json", "Cache-Control": "no-store"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: payload))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
