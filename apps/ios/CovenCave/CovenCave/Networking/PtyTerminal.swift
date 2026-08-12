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
///
/// Reliability: every failure path — receive, send, keepalive ping — funnels
/// into `fail`, which coalesces the burst into a single backoff retry. An idle
/// link is probed with periodic pings so a silent drop is caught before it
/// eats a keystroke, and `verifyLiveness` re-probes on foregrounding since iOS
/// kills sockets during suspension without flipping any local state.
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

    /// One shared session for WebSocket tasks — a `URLSession` is never
    /// deallocated once created, so building one per (re)connect leaked them.
    private static let wsSession = URLSession(configuration: .default)

    /// Last connect parameters, kept for transparent auto-reconnect (the
    /// server holds the shell through a detach grace window and replays
    /// scrollback on reattach, so a transient drop is recoverable in place).
    private var lastWsBase: URL?
    private var lastThreadId = ""
    private var lastProjectRoot: String?
    private var lastCols = 80
    private var lastRows = 24
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    /// True while a backoff retry is queued — extra failures (a dead socket
    /// usually errors on receive, send, *and* ping at once) must coalesce into
    /// the one pending retry instead of each burning an attempt.
    private var reconnectPending = false
    /// Bumped whenever a pending retry is invalidated (`disconnect`, a fresh
    /// schedule); a superseded retry body sees the mismatch and stands down.
    private var reconnectEpoch = 0
    private var pingTask: Task<Void, Never>?
    private static let maxAutoReconnects = 3
    private static let pingInterval: Duration = .seconds(20)
    /// Handshake deadline — the URLSession default (60s) leaves the terminal
    /// looking alive for a minute when the desktop is unreachable.
    private static let handshakeTimeout: TimeInterval = 15

    func connect(wsBase: URL, threadId: String, projectRoot: String?, cols: Int, rows: Int) {
        lastWsBase = wsBase
        lastThreadId = threadId
        lastProjectRoot = projectRoot
        lastCols = cols
        lastRows = rows
        reconnectAttempt = 0
        open()
    }

    private func open() {
        guard let wsBase = lastWsBase else { return }
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
        var items = [URLQueryItem(name: "threadId", value: lastThreadId)]
        if let projectRoot = lastProjectRoot, !projectRoot.isEmpty {
            items.append(URLQueryItem(name: "projectRoot", value: projectRoot))
        }
        comps.queryItems = items
        guard let url = comps.url else { error = "Bad terminal URL."; return }

        // Same credential as the REST client — the pty-ws upgrade passes
        // through the token gate too on a paired desktop.
        var wsRequest = URLRequest(url: url)
        wsRequest.timeoutInterval = Self.handshakeTimeout
        let credential: String?
        do {
            credential = try CaveConnection.credentialForRequest(to: url)
        } catch {
            self.error = error.localizedDescription
            return
        }
        if let token = credential {
            wsRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let ws = Self.wsSession.webSocketTask(with: wsRequest)
        task = ws
        ws.resume()
        connected = true
        sendResize(cols: lastCols, rows: lastRows)
        startReceiving()
        startPinging(ws)
    }

    func disconnect() {
        reconnectEpoch += 1
        reconnectPending = false
        reconnectTask?.cancel()
        reconnectTask = nil
        pingTask?.cancel()
        pingTask = nil
        receiveLoop?.cancel()
        receiveLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    /// Foreground probe: iOS quietly kills sockets while the app is suspended,
    /// but `connected` can still read true afterwards, so a scene-active
    /// "reconnect only if disconnected" check never fires. Ping the link and,
    /// if it's gone, reconnect with a fresh retry budget.
    func verifyLiveness() {
        guard connected, !exited, let ws = task else { return }
        ws.sendPing { [weak self] error in
            guard let error else { return }
            Task { @MainActor [weak self] in
                guard let self, self.task === ws else { return }
                self.reconnectAttempt = 0
                self.fail(error)
            }
        }
    }

    /// Recovery path for a renderer that lost all client state (WKWebView
    /// content-process death): reopen the socket with a fresh retry budget so
    /// the server's scrollback replay repaints the fresh emulator.
    func reattach() {
        guard lastWsBase != nil, !exited else { return }
        reconnectAttempt = 0
        open()
    }

    // MARK: - Sending

    func sendInput(_ string: String) {
        guard let task else { return }
        var frame = Data([0x03])
        frame.append(Data(string.utf8))
        send(frame, over: task)
    }

    func sendResize(cols: Int, rows: Int) {
        guard let task, cols > 0, rows > 0 else { return }
        lastCols = cols
        lastRows = rows
        var frame = Data([0x04])
        var c = UInt16(min(cols, 0xFFFF)).littleEndian
        var r = UInt16(min(rows, 0xFFFF)).littleEndian
        withUnsafeBytes(of: &c) { frame.append(contentsOf: $0) }
        withUnsafeBytes(of: &r) { frame.append(contentsOf: $0) }
        send(frame, over: task)
    }

    /// A failed send proves the socket is dead even when the receive loop
    /// hasn't noticed yet (half-open link after a network handoff). Swallowing
    /// the error — the old behaviour — let keystrokes vanish forever; routing
    /// it into `fail` triggers the same auto-reconnect as a receive error.
    private func send(_ frame: Data, over ws: URLSessionWebSocketTask) {
        ws.send(.data(frame)) { [weak self] error in
            guard let error else { return }
            Task { @MainActor [weak self] in
                guard let self, self.task === ws else { return }
                self.fail(error)
            }
        }
    }

    // MARK: - Keepalive

    /// Periodic protocol-level pings. An idle terminal (user just reading
    /// output) exchanges no frames, so a silently dropped link — NAT timeout,
    /// Wi-Fi → LTE handoff, desktop sleep — would otherwise go unnoticed until
    /// the next keystroke was eaten. The loop is pinned to one socket and
    /// stands down once it's replaced.
    private func startPinging(_ ws: URLSessionWebSocketTask) {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.pingInterval)
                guard let self, !Task.isCancelled, self.task === ws else { return }
                ws.sendPing { [weak self] error in
                    guard let error else { return }
                    Task { @MainActor [weak self] in
                        guard let self, self.task === ws else { return }
                        self.fail(error)
                    }
                }
            }
        }
    }

    // MARK: - Receiving

    private func startReceiving() {
        // The closure inherits this class's @MainActor isolation, so member
        // access is synchronous; only `ws.receive()` actually suspends. The
        // socket is pinned per loop: a replaced/cancelled socket's dangling
        // receive resumes with a stale error after reconnect, and reporting
        // it through fail() would clobber the live connection's state.
        receiveLoop = Task { [weak self] in
            guard let ws = self?.task else { return }
            while !Task.isCancelled {
                guard let self, self.task === ws else { break }
                do {
                    let message = try await ws.receive()
                    self.handle(message)
                } catch {
                    if !Task.isCancelled, self.task === ws { self.fail(error) }
                    break
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        // Any server frame proves the link is live — refill the retry budget.
        reconnectAttempt = 0
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
            // The server closes the socket after an exit frame; without this
            // the keepalive would keep pinging the corpse every interval.
            pingTask?.cancel()
            pingTask = nil
        default:
            break
        }
    }

    private func fail(_ error: Error) {
        // A clean close after exit is not an error worth surfacing.
        if exited { return }
        connected = false
        // A dead socket typically errors on receive, send, and ping together;
        // stop the ping loop (open() starts a fresh one) and coalesce the
        // burst into one queued retry instead of burning an attempt each.
        pingTask?.cancel()
        pingTask = nil
        if reconnectPending { return }
        // Transient drop (network handoff, backgrounding, desktop blip):
        // retry with backoff before asking the user — the server's detach
        // grace keeps the shell alive and replays scrollback on reattach.
        if reconnectAttempt < Self.maxAutoReconnects, lastWsBase != nil {
            reconnectAttempt += 1
            self.error = "Connection lost — reconnecting…"
            let delay = 1 << (reconnectAttempt - 1)   // 1s, 2s, 4s
            reconnectEpoch += 1
            let epoch = reconnectEpoch
            reconnectPending = true
            reconnectTask?.cancel()
            reconnectTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard let self, self.reconnectEpoch == epoch else { return }
                self.reconnectPending = false
                guard !self.connected, !self.exited else { return }
                self.open()
            }
            return
        }
        self.error = error.localizedDescription
    }
}
