import Foundation
import SwiftUI

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
    private let start = Date()

    private init() {
        guard let path = ProcessInfo.processInfo.environment["CAVE_SCROLL_TRACE_PATH"] else {
            handle = nil
            return
        }
        FileManager.default.createFile(atPath: path, contents: nil)
        handle = FileHandle(forWritingAtPath: path)
    }

    func note(_ line: String) {
        guard let handle else { return }
        lock.lock()
        defer { lock.unlock() }
        let stamp = String(format: "%8.3f", Date().timeIntervalSince(start))
        handle.write(Data("\(stamp) \(line)\n".utf8))
    }
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
