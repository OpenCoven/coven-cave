import Foundation

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
    static let startTasksLaunchArgument = "--performance-fixture-start-tasks"
    static let defaultsSuiteName = "ai.opencoven.cave.performance-fixture"
    static let projectCount = 20
    static let localChatCount = 1_000
    static let serverSessionCount = 1_000
    static let taskCount = 1_000
    static let familiarCount = 12

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

        let richMarkdown = """
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
        let baseDate = Date(timeIntervalSince1970: 1_700_000_000)
        let threads = (0..<localChatCount).map { index in
            let familiar = familiars[index % familiars.count]
            let project = projects[index % projects.count]
            let isRichStreamingThread = index == 0
            let message = DisplayMessage(
                id: identifier("message", index),
                role: .assistant,
                familiarId: familiar.id,
                text: isRichStreamingThread
                    ? richMarkdown
                    : "Synthetic fixture response \(index + 1).",
                streaming: isRichStreamingThread,
                createdAt: baseDate.addingTimeInterval(TimeInterval(index))
            )
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
