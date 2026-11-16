import Foundation
import SwiftUI
#if DEBUG
import UIKit
#endif

extension View {
    /// DEBUG-only frame log of the transcript for the #6090 UI tests. It is off
    /// unless the test passes `CAVE_SCROLL_TRACE_PATH`, and release builds compile
    /// it away.
    @ViewBuilder
    func chatScrollTrace(following: Bool, userScrolling: Bool, atBottom: Bool) -> some View {
        #if DEBUG
        modifier(ChatScrollTraceModifier(following: following, userScrolling: userScrolling, atBottom: atBottom))
        #else
        self
        #endif
    }
}

#if DEBUG
final class ChatScrollTrace: @unchecked Sendable {
    static let shared = ChatScrollTrace()

    private let lock = NSLock()
    private let handle: FileHandle?
    private let startEpoch = Date().timeIntervalSince1970
    private let startUptime = ProcessInfo.processInfo.systemUptime
    private let maximumBytes = 2_097_152
    private let maximumSeconds: TimeInterval = 240
    private let maximumPanSamples = 1_600
    private var bytesWritten = 0
    private var panSamples = 0
    private var limitReason: String?

    private init() {
        guard let path = ProcessInfo.processInfo.environment["CAVE_SCROLL_TRACE_PATH"], !path.isEmpty else {
            handle = nil
            return
        }
        FileManager.default.createFile(atPath: path, contents: nil)
        handle = FileHandle(forWritingAtPath: path)
        note("traceOrigin epoch=\(startEpoch) uptime=\(startUptime) byteCap=\(maximumBytes) "
            + "secondsCap=\(maximumSeconds) panSampleCap=\(maximumPanSamples)")
    }

    var isRecording: Bool {
        lock.lock()
        defer { lock.unlock() }
        return handle != nil && limitReason == nil && ProcessInfo.processInfo.systemUptime - startUptime < maximumSeconds
    }

    /// Shared across attach/detach cycles: neither the count nor deadline resets.
    func reservePanSample() -> (index: Int?, stopReason: String?) {
        lock.lock()
        defer { lock.unlock() }
        guard handle != nil else { return (nil, "trace-unavailable") }
        if let limitReason { return (nil, limitReason) }
        guard ProcessInfo.processInfo.systemUptime - startUptime < maximumSeconds else { return (nil, "deadline") }
        guard panSamples < maximumPanSamples else { return (nil, "sample-cap") }
        panSamples += 1
        return (panSamples, nil)
    }

    @discardableResult
    func note(_ line: String) -> Bool {
        guard let handle else { return false }
        lock.lock()
        defer { lock.unlock() }
        guard limitReason == nil else { return false }
        let uptime = ProcessInfo.processInfo.systemUptime
        let elapsed = uptime - startUptime
        let stamp = String(format: "%8.3f", elapsed)
        let suffix = " epoch=\(Date().timeIntervalSince1970) uptime=\(uptime)\n"
        let truncation = line.count > 8_000 ? " recordTruncated=true" : ""
        let data = Data("\(stamp) \(line.prefix(8_000))\(truncation)\(suffix)".utf8)
        let reason = elapsed >= maximumSeconds ? "deadline" : "byte-cap"
        if elapsed >= maximumSeconds || bytesWritten + data.count > maximumBytes - 256 {
            let terminal = Data("\(stamp) traceLimit reason=\(reason) bytes=\(bytesWritten) panSamples=\(panSamples)\(suffix)".utf8)
            if bytesWritten + terminal.count <= maximumBytes {
                guard appendLocked(terminal, to: handle) else { return false }
            }
            // A terminal write error already latched write-error. Never replace
            // that failure with the nominal deadline/byte-cap reason.
            if limitReason == nil { limitReason = reason }
            return false
        }
        return appendLocked(data, to: handle)
    }

    /// Called only with lock held. No retry, reopen, arbitrary error or path log.
    private func appendLocked(_ data: Data, to handle: FileHandle) -> Bool {
        do {
            try handle.write(contentsOf: data)
            bytesWritten += data.count
            return true
        } catch {
            if limitReason != "write-error" {
                limitReason = "write-error"
                // Out-of-band evidence must survive an unusable trace file.
                NSLog("CAVE_SCROLL_TRACE_WRITE_ERROR")
            }
            return false
        }
    }

}

/// Diagnostic observer only. No new recognizer, delegate, touch handling,
/// policy, enablement, or content-offset assignment is introduced.
@MainActor
final class ChatScrollPanDiagnostic: NSObject {
    private weak var scrollView: UIScrollView?
    private weak var pan: UIPanGestureRecognizer?
    private var timer: Timer?
    private var stopped = false
    private var lastSignature: String?
    private var lastLoggedUptime: TimeInterval = 0

    init(scrollView: UIScrollView) {
        self.scrollView = scrollView
        self.pan = scrollView.panGestureRecognizer
        super.init()
        guard ChatScrollTrace.shared.isRecording else { stopped = true; return }
        pan?.addTarget(self, action: #selector(panChanged(_:)))
        sample(trigger: "attach", force: true)
        guard !stopped else { return }
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                self.sample(trigger: "poll")
            }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop(reason: String) {
        guard !stopped else { return }
        stopped = true
        timer?.invalidate()
        timer = nil
        pan?.removeTarget(self, action: #selector(panChanged(_:)))
        pan = nil
        ChatScrollTrace.shared.note("panObserverStop reason=\(reason)")
    }

    @objc private func panChanged(_ recognizer: UIPanGestureRecognizer) {
        sample(trigger: "pan-target", force: true)
    }

    private func sample(trigger: String, force: Bool = false) {
        guard !stopped else { return }
        guard let scrollView, let window = scrollView.window else { stop(reason: "view-detached"); return }
        let reservation = ChatScrollTrace.shared.reservePanSample()
        guard let index = reservation.index else {
            stop(reason: reservation.stopReason ?? "unknown-limit")
            return
        }
        let bounds = scrollView.bounds
        let frame = scrollView.convert(bounds, to: window)
        guard [bounds.minX, bounds.minY, bounds.width, bounds.height,
               window.bounds.width, window.bounds.height].allSatisfy({ $0.isFinite }),
              bounds.width > 0, bounds.height > 0, window.bounds.width > 0, window.bounds.height > 0 else {
            if !ChatScrollTrace.shared.note("panProbe sample=\(index) trigger=\(trigger) invalidBounds") {
                stop(reason: "trace-stopped")
            }
            return
        }
        let nativeStart = scrollView.convert(CGPoint(x: bounds.midX, y: bounds.minY + bounds.height * 0.6), to: window)
        let nativeEnd = scrollView.convert(CGPoint(x: bounds.midX, y: bounds.minY + bounds.height * 0.5), to: window)
        // Exact archived hosted event points. These are observations only,
        // never injected. Native-derived points are logged independently.
        let endpoints: [(String, CGPoint)] = [
            ("native-start", nativeStart), ("native-end", nativeEnd),
            ("host-start", CGPoint(x: 201, y: 460.8)), ("host-end", CGPoint(x: 201, y: 384)),
        ]
        guard endpoints.allSatisfy({ $0.1.x.isFinite && $0.1.y.isFinite }) else {
            if !ChatScrollTrace.shared.note("panProbe sample=\(index) trigger=\(trigger) invalidEndpoints") {
                stop(reason: "trace-stopped")
            }
            return
        }
        var grouped: [(labels: String, point: CGPoint)] = []
        for (label, point) in endpoints {
            if let match = grouped.firstIndex(where: { abs($0.point.x - point.x) < 0.01 && abs($0.point.y - point.y) < 0.01 }) {
                grouped[match].labels += "," + label
            } else { grouped.append((label, point)) }
        }
        let hitRecords = grouped.map { entry in
            let hit = window.hitTest(entry.point, with: nil)
            let inside = hit.map { $0 === scrollView || $0.isDescendant(of: scrollView) } ?? false
            return "\(entry.labels)@\(point(entry.point)) inOuter=\(inside) ancestry=\(ancestry(hit))"
        }.joined(separator: " | ")
        let panState = pan.map { "\($0.state.rawValue):enabled=\($0.isEnabled):touches=\($0.numberOfTouches)" } ?? "nil"
        let signature = "pan=\(panState) tracking=\(scrollView.isTracking) dragging=\(scrollView.isDragging) "
            + "decelerating=\(scrollView.isDecelerating) enabled=\(scrollView.isScrollEnabled) "
            + "offset=\(point(scrollView.contentOffset)) content=\(size(scrollView.contentSize)) "
            + "bounds=\(rect(bounds)) frameWindow=\(rect(frame)) window=\(rect(window.bounds)) "
            + "inset=\(inset(scrollView.adjustedContentInset)) hits=[\(hitRecords)]"
        let uptime = ProcessInfo.processInfo.systemUptime
        guard force || signature != lastSignature || uptime - lastLoggedUptime >= 1 else { return }
        lastSignature = signature
        lastLoggedUptime = uptime
        if !ChatScrollTrace.shared.note("panProbe sample=\(index) trigger=\(trigger) \(signature)") {
            stop(reason: "trace-stopped")
        }
    }

    /// Class/state metadata only: no text, labels, values, identifiers, URLs,
    /// addresses, private payloads, or gesture delegates are inspected.
    private func ancestry(_ hit: UIView?) -> String {
        var view = hit
        var records: [String] = []
        for _ in 0..<6 {
            guard let current = view else { break }
            let gestures = (current.gestureRecognizers ?? []).prefix(3).map {
                "\(String(NSStringFromClass(type(of: $0)).prefix(40))):\($0.state.rawValue):\($0.isEnabled)"
            }.joined(separator: ",")
            records.append("\(String(NSStringFromClass(type(of: current)).prefix(40))){\(gestures)}")
            view = current.superview
        }
        return records.isEmpty ? "nil" : records.joined(separator: ">") + (view == nil ? "" : ">truncated")
    }

    private func number(_ value: CGFloat) -> String { String(format: "%.2f", Double(value)) }
    private func point(_ value: CGPoint) -> String { "\(number(value.x)),\(number(value.y))" }
    private func size(_ value: CGSize) -> String { "\(number(value.width)),\(number(value.height))" }
    private func rect(_ value: CGRect) -> String { "\(point(value.origin)),\(size(value.size))" }
    private func inset(_ value: UIEdgeInsets) -> String { "\(number(value.top)),\(number(value.left)),\(number(value.bottom)),\(number(value.right))" }
}

private struct ChatScrollTraceSample: Equatable {
    let offset: Int
    let contentHeight: Int
    let viewportHeight: Int
    let bottomInset: Int
}

private struct ChatScrollTraceModifier: ViewModifier {
    let following: Bool
    let userScrolling: Bool
    let atBottom: Bool

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: ChatScrollTraceSample.self) { geometry in
                ChatScrollTraceSample(
                    offset: Int(geometry.contentOffset.y.rounded()),
                    contentHeight: Int(geometry.contentSize.height.rounded()),
                    viewportHeight: Int(geometry.containerSize.height.rounded()),
                    bottomInset: Int(geometry.contentInsets.bottom.rounded())
                )
            } action: { _, sample in
                let fromEnd = sample.contentHeight + sample.bottomInset - sample.viewportHeight - sample.offset
                ChatScrollTrace.shared.note(
                    "geo y=\(sample.offset) h=\(sample.contentHeight) fromEnd=\(fromEnd) "
                        + "follow=\(following) user=\(userScrolling) atBottom=\(atBottom)"
                )
            }
            .onScrollPhaseChange { _, phase in
                ChatScrollTrace.shared.note("phase \(String(describing: phase))")
            }
    }
}
#endif
