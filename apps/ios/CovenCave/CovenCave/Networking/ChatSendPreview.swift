#if DEBUG
import Foundation

/// Isolated native UI fixture for the moment after send (#5933). The preview
/// chats have no connection, so their composer cannot send at all. Launched
/// with `--ui-preview-chat-send`, they get a connection whose session is this
/// in-process transport: the send request is accepted and held open, as when
/// a harness has not produced output yet, and every other request is refused.
/// Nothing leaves the process, the protocol is never registered globally, and
/// a production session never carries it.
enum ChatSendPreview {
    static let argument = "--ui-preview-chat-send"
    static let origin = "http://chat-send-preview.invalid"

    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains(argument)
    }

    /// A live send persists its delivery checkpoint before dispatch. The
    /// preview writes that checkpoint to a scratch file it never reads back,
    /// so the saved thread store is never touched.
    static var threadStoreURL: URL? {
        guard isRequested else { return nil }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("ui-preview-chat-send", isDirectory: true)
            .appendingPathComponent("threads.json")
    }

    static func sessionIfRequested() -> URLSession? {
        guard isRequested else { return nil }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.protocolClasses = [ChatSendPreviewProtocol.self]
        return URLSession(configuration: config)
    }
}

private final class ChatSendPreviewProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        if request.httpMethod == "POST", url.path == "/api/chat/send" {
            // Accept the turn and send no frames: the reply stays pending.
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "text/event-stream",
                                                          "Cache-Control": "no-store"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            return
        }
        client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
    }

    override func stopLoading() {}
}
#endif
