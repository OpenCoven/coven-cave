import Foundation
import Observation

/// A live terminal session bridged over `/api/pty-ws`.
///
/// Wire protocol (binary frames, matching server.ts):
///   server → client:  [0x01] + utf8 output  |  [0x02] + int32LE exit code
///   client → server:  [0x03] + utf8 input   |  [0x04] + u16LE cols + u16LE rows
///
/// This is the transport only: raw output bytes are handed to `onData` (the
/// xterm.js emulator in `XtermWebView` renders them — colours, cursor moves,
/// alternate-screen TUIs), and `onReset` fires on each (re)connect so the view
/// can clear before the server replays scrollback.
@Observable
@MainActor
final class PtyTerminal {
    private(set) var connected = false
    private(set) var exited = false
    private(set) var exitCode: Int32?
    private(set) var error: String?

    /// Raw PTY output bytes (the 0x01 payload), in arrival order.
    var onData: ((Data) -> Void)?
    /// Fired at the start of each connect so the renderer can clear.
    var onReset: (() -> Void)?

    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?

    func connect(wsBase: URL, threadId: String, projectRoot: String?, cols: Int, rows: Int) {
        disconnect()
        exited = false
        exitCode = nil
        error = nil
        onReset?()

        guard var comps = URLComponents(url: wsBase.appendingPathComponent("api/pty-ws"),
                                        resolvingAgainstBaseURL: false) else {
            error = "Bad terminal URL."
            return
        }
        var items = [URLQueryItem(name: "threadId", value: threadId)]
        if let projectRoot, !projectRoot.isEmpty {
            items.append(URLQueryItem(name: "projectRoot", value: projectRoot))
        }
        comps.queryItems = items
        guard let url = comps.url else { error = "Bad terminal URL."; return }

        let session = URLSession(configuration: .default)
        // Same credential as the REST client — the pty-ws upgrade passes
        // through the token gate too on a paired desktop.
        var wsRequest = URLRequest(url: url)
        if let token = CaveConnection.accessToken {
            wsRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let ws = session.webSocketTask(with: wsRequest)
        task = ws
        ws.resume()
        connected = true
        sendResize(cols: cols, rows: rows)
        startReceiving()
    }

    func disconnect() {
        receiveLoop?.cancel()
        receiveLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    // MARK: - Sending

    func sendInput(_ string: String) {
        guard let task else { return }
        var frame = Data([0x03])
        frame.append(Data(string.utf8))
        task.send(.data(frame)) { _ in }
    }

    func sendResize(cols: Int, rows: Int) {
        guard let task, cols > 0, rows > 0 else { return }
        var frame = Data([0x04])
        var c = UInt16(min(cols, 0xFFFF)).littleEndian
        var r = UInt16(min(rows, 0xFFFF)).littleEndian
        withUnsafeBytes(of: &c) { frame.append(contentsOf: $0) }
        withUnsafeBytes(of: &r) { frame.append(contentsOf: $0) }
        task.send(.data(frame)) { _ in }
    }

    // MARK: - Receiving

    private func startReceiving() {
        // The closure inherits this class's @MainActor isolation, so member
        // access is synchronous; only `task.receive()` actually suspends.
        receiveLoop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let task = self.task else { break }
                do {
                    let message = try await task.receive()
                    self.handle(message)
                } catch {
                    self.fail(error)
                    break
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .data(let data):
            handleFrame(data)
        case .string(let s):
            // Server speaks binary; tolerate stray text frames as raw output.
            onData?(Data(s.utf8))
        @unknown default:
            break
        }
    }

    private func handleFrame(_ data: Data) {
        guard let tag = data.first else { return }
        switch tag {
        case 0x01:
            onData?(data.subdata(in: 1..<data.count))
        case 0x02:
            if data.count >= 5 {
                exitCode = data.subdata(in: 1..<5).withUnsafeBytes { $0.load(as: Int32.self) }
            }
            exited = true
            connected = false
        default:
            break
        }
    }

    private func fail(_ error: Error) {
        // A clean close after exit is not an error worth surfacing.
        if exited { return }
        self.error = error.localizedDescription
        connected = false
    }
}
