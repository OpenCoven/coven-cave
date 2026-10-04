import Foundation
import OSLog
import UIKit

struct CavePerformanceFixtureSnapshot {
    let projects: [ProjectInfo]
    let threads: [ChatThread]
    let serverSessions: [SessionRow]
    let tasks: [BoardCard]
    let familiars: [Familiar]
    let projectMembership: ProjectMembershipIndex
}

@MainActor
enum CavePerformanceFixture {
    static let launchArgument = "--performance-fixture"
    static var isTranscriptRecoveryFixture: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return shouldEnable(arguments: arguments) && arguments.contains("--transcript-recovery-fixture")
    }

    /// `--image-zoom-fixture` puts two synthetic inline images in "Fixture chat 2"
    /// and stops the streaming loop, so repeated zoom/dismiss cycles (#5314) run
    /// without unrelated rendering churn.
    static let imageZoomLaunchArgument = "--image-zoom-fixture"
    static var isImageZoomFixture: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return shouldEnable(arguments: arguments) && arguments.contains(imageZoomLaunchArgument)
    }

    static func setRecoveryFixtureText(in thread: ChatThread, shrunk: Bool) {
        guard isTranscriptRecoveryFixture, thread.id == identifier("chat", 0) else { return }
        let paragraphs = shrunk ? "Recovered short response." : String(repeating:
            "A deliberately long synthetic response for transcript recovery. Read above its tail before shrinking it.\n\n", count: 100)
        thread.replaceStreamingText(identifier("message", 0),
            "# Transcript recovery fixture\n\n" + paragraphs
                + "\n\n[Transcript recovery tail](https://example.com/transcript-recovery)")
    }

    static let defaultsSuiteName = "ai.opencoven.cave.performance-fixture"
    static let projectCount = 20
    static let localChatCount = 1_000
    static let serverSessionCount = 1_000
    static let taskCount = 1_000
    static let familiarCount = 12
    private static let streamingFrameCount = 200
    private static let streamingToken = "Synthetic streaming token. "
    private static let streamingResponse = String(repeating: streamingToken, count: streamingFrameCount)

    static let richMarkdown = """
    # Performance Fixture

    | Signal | State |
    | --- | --- |
    | Streaming | Active |
    | Source | Synthetic |

    ```swift
    let stableFrame = true
    ```

    - Deterministic content
    - No credentials or user data
    """

    static var threadStoreURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("performance-fixture", isDirectory: true)
            .appendingPathComponent("cave-threads.json")
    }

    static func shouldEnable(arguments: [String]) -> Bool {
        arguments.contains(launchArgument)
    }

    static func makeIsolatedDefaults() -> UserDefaults {
        guard let defaults = UserDefaults(suiteName: defaultsSuiteName) else {
            preconditionFailure("Unable to create performance fixture defaults")
        }
        defaults.removePersistentDomain(forName: defaultsSuiteName)

        let fixtureDirectory = threadStoreURL.deletingLastPathComponent()
        do {
            if FileManager.default.fileExists(atPath: fixtureDirectory.path) {
                try FileManager.default.removeItem(at: fixtureDirectory)
            }
        } catch {
            preconditionFailure("Unable to reset performance fixture persistence: \(error)")
        }
        return defaults
    }

    static func make() -> CavePerformanceFixtureSnapshot {
        let projects = (0..<projectCount).map { index in
            ProjectInfo(
                id: identifier("project", index),
                name: "Fixture Project \(index + 1)",
                root: "/performance-fixture/project-\(padded(index))",
                color: nil,
                updatedAt: timestamp(index),
                access: .write
            )
        }
        let familiars = (0..<familiarCount).map { index in
            Familiar(
                id: identifier("familiar", index),
                displayName: "Fixture Familiar \(index + 1)",
                role: "Synthetic performance role \(index + 1)",
                description: "Deterministic non-sensitive profiling data.",
                pronouns: nil,
                color: nil,
                status: index.isMultiple(of: 3) ? "busy" : "active",
                harness: "fixture",
                model: "fixture-model",
                icon: "sparkles",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fixture"
            )
        }

        let baseDate = Date(timeIntervalSince1970: 1_700_000_000)
        let threads = (0..<localChatCount).map { index in
            let familiar = familiars[index % familiars.count]
            let project = projects[index % projects.count]
            let isRichStreamingThread = index == 0
            let isImageZoomThread = index == 1 && isImageZoomFixture
            var message = DisplayMessage(
                id: identifier("message", index),
                role: .assistant,
                familiarId: familiar.id,
                text: isRichStreamingThread
                    ? richMarkdown
                    : isImageZoomThread
                    ? imageZoomMarkdown()
                    : "Synthetic fixture response \(index + 1).",
                streaming: isRichStreamingThread,
                createdAt: baseDate.addingTimeInterval(TimeInterval(index))
            )
            if isRichStreamingThread && CaveTimelinePerformanceFixture.isEnabled {
                message = CaveTimelinePerformanceFixture.message(from: message, count: CaveTimelinePerformanceFixture.count,
                                                                shape: CaveTimelinePerformanceFixture.shape)
            }
            let thread = ChatThread(
                id: identifier("chat", index),
                title: isRichStreamingThread
                    ? "Rich streaming fixture"
                    : "Fixture chat \(index + 1)",
                familiarIds: [familiar.id],
                sessionIds: index < 500
                    ? [familiar.id: identifier("session", index)]
                    : [:],
                projectRoot: index == localChatCount - 1 ? nil : project.root,
                messages: [message]
            )
            thread.updatedAt = baseDate.addingTimeInterval(
                TimeInterval(localChatCount - index)
            )
            return thread
        }

        let serverSessions = (0..<serverSessionCount).map { index in
            let familiar = familiars[index % familiars.count]
            let project = projects[(index * 3) % projects.count]
            return SessionRow(
                id: identifier("session", index),
                title: "Fixture server session \(index + 1)",
                harness: "fixture",
                model: "fixture-model",
                runtime: "fixture:local",
                status: index == 0 ? "streaming" : "idle",
                familiarId: familiar.id,
                createdAt: timestamp(index),
                updatedAt: timestamp(serverSessionCount - index),
                archivedAt: nil,
                pinned: index.isMultiple(of: 100) ? true : nil,
                projectRoot: index == serverSessionCount - 1
                    ? "/performance-fixture/recovery/missing-project"
                    : project.root,
                origin: nil,
                generated: false
            )
        }

        let tasks = (0..<taskCount).map { index in
            let familiar = familiars[index % familiars.count]
            let project = projects[(index * 7) % projects.count]
            return BoardCard(
                id: identifier("task", index),
                title: "Fixture task \(index + 1)",
                notes: index == 0 ? richMarkdown : "Synthetic task notes.",
                statusRaw: CardStatus.allCases[index % CardStatus.allCases.count].rawValue,
                priorityRaw: CardPriority.allCases[index % CardPriority.allCases.count].rawValue,
                familiarId: familiar.id,
                projectId: index == taskCount - 1 ? "fixture-missing-project" : project.id,
                sessionId: index < 500 ? identifier("session", index) : nil,
                labels: ["performance-fixture"],
                startDate: nil,
                endDate: nil,
                createdAt: timestamp(index),
                updatedAt: timestamp(taskCount - index),
                needsHuman: index == taskCount - 1,
                steps: nil,
                github: nil
            )
        }

        let membership = ProjectMembershipIndex(
            familiarIDsByProjectID: Dictionary(
                uniqueKeysWithValues: projects.enumerated().map { index, project in
                    let memberIDs = (0..<4).map {
                        familiars[(index + $0 * 3) % familiars.count].id
                    }
                    return (project.id, Set(memberIDs))
                }
            )
        )

        return CavePerformanceFixtureSnapshot(
            projects: projects,
            threads: threads,
            serverSessions: serverSessions,
            tasks: tasks,
            familiars: familiars,
            projectMembership: membership
        )
    }

    static func install(in app: AppModel) {
        install(make(), in: app)
    }

    static func install(_ fixture: CavePerformanceFixtureSnapshot, in app: AppModel) {
        app.projects = fixture.projects
        app.projectsLoaded = true
        app.familiars = fixture.familiars
        app.familiarsLoaded = true
        app.threads = fixture.threads
        app.serverSessions = fixture.serverSessions
        app.sessionsLoaded = true
        app.tasks = fixture.tasks
        app.tasksLoaded = true
        app.projectMembership = fixture.projectMembership
        app.projectMembershipLoaded = true
        app.projectContext = fixture.projects.first.map(ProjectContext.project)
        app.connectionState = .connected
        if isTranscriptRecoveryFixture, let thread = fixture.threads.first {
            setRecoveryFixtureText(in: thread, shrunk: false)
        }
    }

    /// Stream a ten-second synthetic response at the coalesced UI cadence, then
    /// keep revising its final token in place so rendering never goes idle.
    /// This measures transcript/render work; it does not simulate network cost.
    static func runStreaming(in app: AppModel) async {
        guard app.isPerformanceFixture, !isTranscriptRecoveryFixture, !isImageZoomFixture, !CaveTimelinePerformanceFixture.isEnabled,
              let thread = app.threads.first(where: { $0.id == identifier("chat", 0) })
        else { return }
        var frame = 0
        while !Task.isCancelled {
            do { try await Task.sleep(for: .milliseconds(50)) }
            catch { return }
            guard !Task.isCancelled else { return }
            applyStreamingFrame(frame, to: thread)
            // Past full length, alternate between the two same-length revisions.
            frame = frame < streamingFrameCount ? frame + 1 : streamingFrameCount + (frame + 1 - streamingFrameCount) % 2
        }
    }

    static func applyStreamingFrame(_ frame: Int, to thread: ChatThread) {
        guard thread.id == identifier("chat", 0) else { return }
        let grown = min(max(0, frame), streamingFrameCount - 1) + 1
        var text = richMarkdown + "\n\n" + streamingResponse.prefix(grown * streamingToken.count)
        if frame >= streamingFrameCount {
            // A live reply only grows. Snapping back to the opening text is a
            // multi-thousand-point shrink that left the transcript blank when it
            // was not following the latest message (#5613), so full length is
            // held and only the final character alternates.
            text += frame.isMultiple(of: 2) ? "·" : "•"
        }
        // Live replies append without touching `updatedAt`; `updateText`
        // would re-sort and rebuild the whole Chats list on every frame.
        thread.replaceStreamingText(identifier("message", 0), text)
    }

    // MARK: Inline image zoom fixture (#5314)

    /// Two deterministic synthetic JPEG data URLs: a 48-megapixel source that
    /// the zoom path must downsample to its 4,096-pixel target, and a small one.
    /// No user content; generated on launch only under the zoom fixture flag.
    static func imageZoomMarkdown() -> String {
        let large = syntheticJPEGDataURL(width: 8_000, height: 6_000, hue: 0.58)
        let small = syntheticJPEGDataURL(width: 1_600, height: 1_200, hue: 0.08)
        return """
        # Image zoom fixture

        ![Zoom fixture image A](\(large))

        ![Zoom fixture image B](\(small))
        """
    }

    private static func syntheticJPEGDataURL(width: Int, height: Int, hue: CGFloat) -> String {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: width, height: height)
        let data = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.8) { context in
            let cg = context.cgContext
            let colors = [UIColor(hue: hue, saturation: 0.7, brightness: 0.9, alpha: 1).cgColor,
                          UIColor(hue: hue + 0.3, saturation: 0.6, brightness: 0.4, alpha: 1).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])
            }
            cg.setStrokeColor(UIColor.white.withAlphaComponent(0.5).cgColor)
            cg.setLineWidth(4)
            let step = max(width, height) / 40
            for x in stride(from: 0, through: width, by: step) {
                cg.move(to: CGPoint(x: x, y: 0)); cg.addLine(to: CGPoint(x: x, y: height))
            }
            for y in stride(from: 0, through: height, by: step) {
                cg.move(to: CGPoint(x: 0, y: y)); cg.addLine(to: CGPoint(x: width, y: y))
            }
            cg.strokePath()
        }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    private static let zoomSignposter = OSSignposter(
        subsystem: "ai.opencoven.cave",
        category: OSLog.Category.pointsOfInterest.rawValue
    )

    /// Emits the process's physical footprint as a Points of Interest event so
    /// a trace can read residual memory per zoom cycle. Image zoom fixture only.
    static func recordZoomFootprint(_ phase: ZoomPhase) {
        guard isImageZoomFixture, let bytes = physicalFootprint() else { return }
        switch phase {
        case .presented:
            zoomSignposter.emitEvent("image.zoom.footprint", "presented \(bytes, privacy: .public)")
        case .dismissed:
            zoomSignposter.emitEvent("image.zoom.footprint", "dismissed \(bytes, privacy: .public)")
        case .settled:
            zoomSignposter.emitEvent("image.zoom.footprint", "settled \(bytes, privacy: .public)")
        }
    }

    /// Records the dismissed footprint, then the settled footprint one second
    /// later, after the cover's teardown has had time to release its image.
    static func zoomDismissed() {
        guard isImageZoomFixture else { return }
        recordZoomFootprint(.dismissed)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            recordZoomFootprint(.settled)
        }
    }

    enum ZoomPhase { case presented, dismissed, settled }

    static func physicalFootprint() -> UInt64? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? info.phys_footprint : nil
    }

    private static func identifier(_ kind: String, _ index: Int) -> String {
        "performance-fixture-\(kind)-\(padded(index))"
    }

    private static func padded(_ index: Int) -> String {
        String(format: "%04d", index)
    }

    private static func timestamp(_ index: Int) -> String {
        String(format: "2026-01-%02dT%02d:%02d:00Z",
               (index % 28) + 1,
               index % 24,
               index % 60)
    }
}
