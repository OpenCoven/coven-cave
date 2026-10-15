import Foundation

/// The server, or this client, closed the event socket with `code` (#5864).
struct CaveEventTransportClosed: Error, Equatable {
    let code: Int
}

/// One event-socket connection. `CaveEventSocket` owns the protocol; a
/// transport only moves frames, so tests can drive the actor without a server.
protocol CaveEventSocketTransport: AnyObject, Sendable {
    /// Resolves once the upgrade completes, or throws when it is refused,
    /// fails, or the transport is closed first.
    func open(_ request: URLRequest) async throws
    func send(_ text: String) async throws
    /// Throws `CaveEventTransportClosed` once the socket is closed.
    func receive() async throws -> URLSessionWebSocketTask.Message
    func sendPing() async throws
    /// Close and release the connection. Pending `open` and `receive` calls throw.
    func close(code: Int, reason: String?)
}

/// `URLSessionWebSocketTask` behind the transport contract.
final class URLSessionCaveEventTransport: NSObject, CaveEventSocketTransport, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var closedCode: Int?

    func open(_ request: URLRequest) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let configuration = URLSessionConfiguration.ephemeral
            configuration.waitsForConnectivity = false
            // The session retains its delegate until it is invalidated in `close`.
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            let task = session.webSocketTask(with: request)
            task.maximumMessageSize = CaveEventWire.maxMessageBytes * 4
            lock.lock()
            if let code = closedCode {
                lock.unlock()
                session.invalidateAndCancel()
                continuation.resume(throwing: CaveEventTransportClosed(code: code))
                return
            }
            self.session = session
            self.task = task
            openContinuation = continuation
            lock.unlock()
            task.resume()
        }
    }

    func send(_ text: String) async throws {
        guard let task = currentTask() else { throw CaveEventTransportClosed(code: closedCodeValue()) }
        try await task.send(.string(text))
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        guard let task = currentTask() else { throw CaveEventTransportClosed(code: closedCodeValue()) }
        do {
            return try await task.receive()
        } catch {
            let code = task.closeCode.rawValue
            throw CaveEventTransportClosed(code: code == URLSessionWebSocketTask.CloseCode.invalid.rawValue ? closedCodeValue() : code)
        }
    }

    /// Foundation offers only the callback form of a ping.
    func sendPing() async throws {
        guard let task = currentTask() else { throw CaveEventTransportClosed(code: closedCodeValue()) }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            task.sendPing { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func close(code: Int, reason: String?) {
        lock.lock()
        if closedCode == nil { closedCode = code }
        let task = self.task
        let session = self.session
        let pending = openContinuation
        openContinuation = nil
        self.task = nil
        self.session = nil
        lock.unlock()
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .goingAway
        task?.cancel(with: closeCode, reason: reason.map { Data($0.utf8) })
        session?.invalidateAndCancel()
        pending?.resume(throwing: CaveEventTransportClosed(code: code))
    }

    // MARK: URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        takeOpenContinuation()?.resume()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        lock.lock()
        if closedCode == nil { closedCode = closeCode.rawValue }
        lock.unlock()
        takeOpenContinuation()?.resume(throwing: CaveEventTransportClosed(code: closeCode.rawValue))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        takeOpenContinuation()?.resume(throwing: error ?? CaveEventTransportClosed(code: closedCodeValue()))
        session.finishTasksAndInvalidate()
    }

    // MARK: Private

    private func currentTask() -> URLSessionWebSocketTask? {
        lock.lock()
        defer { lock.unlock() }
        return task
    }

    private func closedCodeValue() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return closedCode ?? URLSessionWebSocketTask.CloseCode.abnormalClosure.rawValue
    }

    private func takeOpenContinuation() -> CheckedContinuation<Void, Error>? {
        lock.lock()
        defer { lock.unlock() }
        let continuation = openContinuation
        openContinuation = nil
        return continuation
    }
}
