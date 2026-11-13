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
        client?.urlProtocol(self, didLoad: responseBody(payload: payload, toolId: toolId, status: status))
        client?.urlProtocolDidFinishLoading(self)
    }
    /// Additional cases use the same request, decoder, store, and sheet as the
    /// short fixture. Only the synthetic response bytes change.
    private func responseBody(payload: [String: Any], toolId: String?, status: Int) -> Data {
        let arguments = ProcessInfo.processInfo.arguments
        guard status == 200, toolId == "a",
              let index = arguments.firstIndex(of: "--ui-preview-tool-output-case"),
              arguments.indices.contains(index + 1) else {
            return try! JSONSerialization.data(withJSONObject: payload)
        }
        switch arguments[index + 1] {
        case "oversized-output":
            let marker = "OVERSIZED_OUTPUT_MUST_NOT_DISPLAY"
            let output = marker + String(repeating: "x", count: 256 * 1024 + 1 - marker.utf8.count)
            return try! JSONSerialization.data(withJSONObject: ["ok": true, "output": output])
        case "oversized-envelope":
            // Valid JSON if fully consumed; the bounded transport must stop
            // before decoding or publishing the apparent output.
            let json = #"{"ok":true,"output":"OVERSIZED_ENVELOPE_MUST_NOT_DISPLAY","pad":""#
                + String(repeating: "x", count: 2 * 1024 * 1024) + #""}"#
            return Data(json.utf8)
        case "deep-envelope":
            // A small body can still exceed Foundation's JSON nesting limit.
            // Decoder failures must become a fixed unreadable-response state.
            let json = #"{"ok":true,"output":"DEEP_ENVELOPE_MUST_NOT_DISPLAY","pad":"#
                + String(repeating: "[", count: 2_048) + "0"
                + String(repeating: "]", count: 2_048) + "}"
            return Data(json.utf8)
        case "large-deep-output":
            // Exactly the accepted UTF-8 byte cap. Nested-looking data remains
            // verbatim text; it is never parsed as JSON, HTML, or Markdown.
            let prefix = "LARGE_DEEP_OUTPUT_START\n<script>not executable</script>\n"
                + String(repeating: "[", count: 256) + "0" + String(repeating: "]", count: 256) + "\n"
            let suffix = "\nLARGE_DEEP_OUTPUT_END"
            let output = prefix + String(repeating: "x", count: 256 * 1024 - prefix.utf8.count - suffix.utf8.count) + suffix
            return try! JSONSerialization.data(withJSONObject: ["ok": true, "output": output])
        default:
            return try! JSONSerialization.data(withJSONObject: payload)
        }
    }

    override func stopLoading() {}
}
#endif
