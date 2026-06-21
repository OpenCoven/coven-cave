import Foundation
import Observation

/// A live terminal session bridged over `/api/pty-ws`.
///
/// Wire protocol (binary frames, matching server.ts):
///   server → client:  [0x01] + utf8 output  |  [0x02] + int32LE exit code
///   client → server:  [0x03] + utf8 input   |  [0x04] + u16LE cols + u16LE rows
///
/// Output is run through a small line-discipline (`TerminalScreen`) that strips
/// ANSI escapes and honours CR/BS so progress bars and prompts read correctly —
/// it is not a full emulator, but it makes ordinary command output legible.
@Observable
@MainActor
final class PtyTerminal {
    private(set) var text = ""
    private(set) var connected = false
    private(set) var exited = false
    private(set) var exitCode: Int32?
    private(set) var error: String?

    private var task: URLSessionWebSocketTask?
    private var screen = TerminalScreen()
    private var receiveLoop: Task<Void, Never>?

    func connect(wsBase: URL, threadId: String, projectRoot: String?, cols: Int, rows: Int) {
        disconnect()
        screen = TerminalScreen()
        text = ""
        exited = false
        exitCode = nil
        error = nil

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
        let ws = session.webSocketTask(with: url)
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
            screen.feed(s)
            text = screen.render()
        @unknown default:
            break
        }
    }

    private func handleFrame(_ data: Data) {
        guard let tag = data.first else { return }
        switch tag {
        case 0x01:
            let payload = data.subdata(in: 1..<data.count)
            screen.feed(String(decoding: payload, as: UTF8.self))
            text = screen.render()
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

/// Minimal terminal line-discipline: strips ANSI/OSC escapes and applies CR,
/// BS and NL so ordinary command output (and single-line progress redraws) read
/// correctly. Not a grid emulator — no cursor addressing, colors, or scroll
/// regions — but enough to make a phone terminal usable.
struct TerminalScreen {
    private var lines: [[Character]] = [[]]
    private var cursor = 0          // column within the last line
    private let maxLines = 4000

    mutating func feed(_ raw: String) {
        let cleaned = TerminalScreen.stripEscapes(raw)
        for ch in cleaned {
            switch ch {
            case "\n":
                lines.append([])
                cursor = 0
                trim()
            case "\r":
                cursor = 0
            case "\u{08}":          // backspace
                if cursor > 0 { cursor -= 1 }
            case "\t":
                let spaces = 4 - (cursor % 4)
                for _ in 0..<spaces { put(" ") }
            default:
                if ch.isASCII && ch.asciiValue! < 0x20 { continue }  // drop other control chars
                put(ch)
            }
        }
    }

    private mutating func put(_ ch: Character) {
        var last = lines[lines.count - 1]
        if cursor < last.count {
            last[cursor] = ch
        } else {
            while last.count < cursor { last.append(" ") }
            last.append(ch)
        }
        lines[lines.count - 1] = last
        cursor += 1
    }

    private mutating func trim() {
        if lines.count > maxLines {
            lines.removeFirst(lines.count - maxLines)
        }
    }

    func render() -> String {
        lines.map { String($0) }.joined(separator: "\n")
    }

    /// Remove CSI (`ESC [ … letter`), OSC (`ESC ] … BEL/ST`) and other single
    /// escape sequences, plus the standalone BEL.
    static func stripEscapes(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        let iter = Array(s.unicodeScalars)
        var i = 0
        let esc: Unicode.Scalar = "\u{1B}"
        while i < iter.count {
            let c = iter[i]
            if c == esc, i + 1 < iter.count {
                let n = iter[i + 1]
                if n == "[" {                     // CSI: ESC [ params... final(0x40–0x7E)
                    i += 2
                    while i < iter.count {
                        let v = iter[i].value
                        i += 1
                        if v >= 0x40 && v <= 0x7E { break }
                    }
                    continue
                } else if n == "]" {              // OSC: ESC ] ... (BEL or ST)
                    i += 2
                    while i < iter.count {
                        if iter[i] == "\u{07}" { i += 1; break }
                        if iter[i] == esc, i + 1 < iter.count, iter[i + 1] == "\\" { i += 2; break }
                        i += 1
                    }
                    continue
                } else {                          // other 2-char escape
                    i += 2
                    continue
                }
            }
            if c == "\u{07}" { i += 1; continue }  // bell
            out.append(c)
            i += 1
        }
        return String(out)
    }
}
