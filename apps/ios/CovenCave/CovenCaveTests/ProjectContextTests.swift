import XCTest
@testable import CovenCave

@MainActor
final class ProjectContextTests: XCTestCase {
    private func project(_ id: String, _ name: String, root: String? = nil) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: root ?? "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: nil
        )
    }

    private func familiar(_ id: String, _ name: String) -> Familiar {
        Familiar(
            id: id,
            displayName: name,
            role: nil,
            description: nil,
            pronouns: nil,
            color: nil,
            status: nil,
            harness: nil,
            model: nil,
            icon: nil,
            avatarUrl: nil,
            activeSessions: nil,
            memoryFreshness: nil
        )
    }

    private func thread(
        _ title: String,
        familiarIds: [String],
        projectRoot: String?,
        updatedAt: Date = .distantPast
    ) -> ChatThread {
        let thread = ChatThread(title: title, familiarIds: familiarIds, projectRoot: projectRoot)
        thread.updatedAt = updatedAt
        return thread
    }

    private func session(
        _ id: String,
        familiarId: String?,
        projectRoot: String?,
        updatedAt: String? = nil,
        archivedAt: String? = nil,
        origin: String? = nil,
        generated: Bool? = nil
    ) -> SessionRow {
        SessionRow(
            id: id,
            title: id,
            harness: nil,
            model: nil,
            runtime: nil,
            status: nil,
            familiarId: familiarId,
            createdAt: nil,
            updatedAt: updatedAt,
            archivedAt: archivedAt,
            projectRoot: projectRoot,
            origin: origin,
            generated: generated
        )
    }

    private func card(
        _ id: String,
        familiarId: String?,
        projectId: String?,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) -> BoardCard {
        BoardCard(
            id: id,
            title: id,
            notes: nil,
            statusRaw: "backlog",
            priorityRaw: "medium",
            familiarId: familiarId,
            projectId: projectId,
            sessionId: nil,
            labels: nil,
            startDate: nil,
            endDate: nil,
            createdAt: createdAt,
            updatedAt: updatedAt,
            needsHuman: nil,
            steps: nil,
            github: nil
        )
    }

    private func iso(_ seconds: TimeInterval) -> String {
        PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: seconds))
    }

    func testProjectContextAccessorsAndCodableRoundTrip() throws {
        let context = ProjectContext.project(project("cave", "Coven Cave"))

        XCTAssertEqual(context.id, "project:cave")
        XCTAssertEqual(context.projectId, "cave")
        XCTAssertEqual(context.root, "/repos/cave")
        XCTAssertEqual(context.displayName, "Coven Cave")

        let decoded = try JSONDecoder().decode(
            ProjectContext.self,
            from: JSONEncoder().encode(context)
        )
        XCTAssertEqual(decoded, context)

        XCTAssertEqual(ProjectContext.unassigned.id, "unassigned")
        XCTAssertNil(ProjectContext.unassigned.projectId)
        XCTAssertNil(ProjectContext.unassigned.root)
        XCTAssertEqual(ProjectContext.unassigned.displayName, "Unassigned")
    }

    func testMembershipIndexBuildsFromDirectGroupAndSupremeAccess() {
        let index = ProjectMembershipIndex.build(
            projects: [
                project("cave", "Cave"),
                project("docs", "Docs"),
            ],
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ],
            directGrants: [
                ProjectGrant(familiarId: "nova", projectId: "cave", access: .read),
            ],
            groups: [
                FamiliarAccessGroup(
                    id: "g1",
                    name: "Docs",
                    description: nil,
                    memberFamiliarIds: ["sage"],
                    projectGrants: [GroupProjectGrant(projectId: "docs", access: .write)]
                ),
                FamiliarAccessGroup(
                    id: "g2",
                    name: "Ignored",
                    description: nil,
                    memberFamiliarIds: ["ember"],
                    projectGrants: [GroupProjectGrant(projectId: "cave", access: .read)]
                ),
            ],
            supremeFamiliarId: "supreme"
        )

        XCTAssertEqual(index.familiarIDs(forProjectID: "cave"), Set(["nova", "supreme"]))
        XCTAssertEqual(index.familiarIDs(forProjectID: "docs"), Set(["sage", "supreme"]))
        XCTAssertTrue(index.contains("nova", inProjectID: "cave"))
        XCTAssertFalse(index.contains("sage", inProjectID: "cave"))
        XCTAssertEqual(index.projectIDs(forFamiliarID: "supreme"), ["cave", "docs"])
    }

    func testMembershipIndexDoesNotInferRegisteredAccessFromActivity() {
        let index = ProjectMembershipIndex.build(
            projects: [project("cave", "Cave")],
            familiars: [familiar("nova", "Nova")],
            directGrants: [],
            groups: [],
            supremeFamiliarId: nil
        )

        XCTAssertTrue(index.familiarIDs(forProjectID: "cave").isEmpty)
        XCTAssertEqual(
            ProjectContext.unassignedFamiliarIDs(
                threads: [thread("Offline", familiarIds: ["nova"], projectRoot: nil)],
                sessions: [],
                tasks: [],
                registeredProjects: [project("cave", "Cave")]
            ),
            ["nova"]
        )
    }

    func testDefaultSelectionRestoresCurrentRegisteredProjectBeforeOtherFallbacks() {
        let selection = ProjectContext.defaultSelection(
            restored: .project(project("cave", "Old Name", root: "/old/root")),
            projects: [
                project("docs", "Docs"),
                project("cave", "Coven Cave"),
            ],
            threads: [
                thread(
                    "Docs thread",
                    familiarIds: ["sage"],
                    projectRoot: "/repos/docs",
                    updatedAt: Date(timeIntervalSince1970: 2)
                ),
            ],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("cave", "Coven Cave")))
    }

    func testDefaultSelectionRestoresUnassignedWhenArtifactsStillExist() {
        let selection = ProjectContext.defaultSelection(
            restored: .unassigned,
            projects: [project("cave", "Coven Cave")],
            threads: [thread("Offline", familiarIds: ["nova"], projectRoot: nil)],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(selection, .unassigned)
    }

    func testDefaultSelectionRestoresUnassignedWhenUnregisteredOrTraversalRootsStillExist() {
        let selection = ProjectContext.defaultSelection(
            restored: .unassigned,
            projects: [project("cave", "Coven Cave")],
            threads: [thread("Unknown", familiarIds: ["nova"], projectRoot: "/repos/ghost")],
            sessions: [
                session(
                    "traversal",
                    familiarId: "sage",
                    projectRoot: "/repos/cave/.worktrees/feat-cave/../../escape"
                ),
            ],
            tasks: []
        )

        XCTAssertEqual(selection, .unassigned)
    }

    func testDefaultSelectionUsesMostRecentRegisteredThreadRootAfterInvalidRestore() {
        let selection = ProjectContext.defaultSelection(
            restored: .project(project("missing", "Missing")),
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [
                thread(
                    "Unregistered",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/missing",
                    updatedAt: Date(timeIntervalSince1970: 3)
                ),
                thread(
                    "Zulu",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/zulu",
                    updatedAt: Date(timeIntervalSince1970: 2)
                ),
                thread(
                    "Alpha",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/alpha",
                    updatedAt: Date(timeIntervalSince1970: 1)
                ),
            ],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("zulu", "Zulu")))
    }

    func testDefaultSelectionResolvesTrailingSlashBackslashAndWorktreeThreadRoots() {
        let selection = ProjectContext.defaultSelection(
            restored: .project(project("missing", "Missing")),
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [
                thread(
                    "Missing",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/missing",
                    updatedAt: Date(timeIntervalSince1970: 4)
                ),
                thread(
                    "Zulu",
                    familiarIds: ["nova"],
                    projectRoot: "\\repos\\zulu\\",
                    updatedAt: Date(timeIntervalSince1970: 3)
                ),
                thread(
                    "Alpha worktree",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/alpha/.worktrees/feat-alpha/",
                    updatedAt: Date(timeIntervalSince1970: 2)
                ),
            ],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("zulu", "Zulu")))
    }

    func testDefaultSelectionChoosesLongestRegisteredRootWhenWorktreeRootsNest() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("parent", "Parent", root: "/repos/cave"),
                project("nested", "Nested", root: "/repos/cave/.worktrees/feature"),
            ],
            threads: [
                thread(
                    "Nested worktree",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix/",
                    updatedAt: Date(timeIntervalSince1970: 1)
                ),
            ],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(
            selection,
            .project(project("nested", "Nested", root: "/repos/cave/.worktrees/feature"))
        )
    }

    func testDefaultSelectionSkipsTraversalLikeWorktreeRoots() {
        let selection = ProjectContext.defaultSelection(
            restored: .project(project("missing", "Missing")),
            projects: [
                project("alpha", "Alpha", root: "/work/alpha"),
                project("zulu", "Zulu", root: "/work/zulu"),
            ],
            threads: [
                thread(
                    "Traversal slash",
                    familiarIds: ["nova"],
                    projectRoot: "/work/alpha/.worktrees/feat-x/../../escape",
                    updatedAt: Date(timeIntervalSince1970: 4)
                ),
                thread(
                    "Traversal backslash",
                    familiarIds: ["nova"],
                    projectRoot: "\\work\\alpha\\.worktrees\\feat-x\\..\\..\\escape",
                    updatedAt: Date(timeIntervalSince1970: 3)
                ),
                thread(
                    "Zulu",
                    familiarIds: ["nova"],
                    projectRoot: "/work/zulu",
                    updatedAt: Date(timeIntervalSince1970: 2)
                ),
            ],
            sessions: [],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("zulu", "Zulu", root: "/work/zulu")))
    }

    func testDefaultSelectionCanDelayAlphabeticalFallbackUntilHistoryHydrates() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [],
            sessions: [],
            tasks: [],
            allowAlphabeticalFallback: false
        )

        XCTAssertNil(selection)
    }

    func testDefaultSelectionUsesMostRecentVisibleServerSessionBeforeAlphabeticalFallback() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [],
            sessions: [
                session(
                    "generated",
                    familiarId: "nova",
                    projectRoot: "/repos/zulu",
                    updatedAt: iso(40),
                    generated: true
                ),
                session(
                    "archived",
                    familiarId: "nova",
                    projectRoot: "/repos/zulu",
                    updatedAt: iso(30),
                    archivedAt: iso(45)
                ),
                session(
                    "missing",
                    familiarId: "nova",
                    projectRoot: "/repos/missing",
                    updatedAt: iso(20)
                ),
                session(
                    "alpha",
                    familiarId: "nova",
                    projectRoot: "/repos/alpha",
                    updatedAt: iso(10)
                ),
            ],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("alpha", "Alpha")))
    }

    func testDefaultSelectionUsesMostRecentRegisteredTaskBeforeAlphabeticalFallback() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [],
            sessions: [],
            tasks: [
                card("ghost", familiarId: "nova", projectId: "ghost", updatedAt: iso(50)),
                card("alpha-task", familiarId: "nova", projectId: "alpha", updatedAt: iso(10)),
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(20)),
            ]
        )

        XCTAssertEqual(selection, .project(project("zulu", "Zulu")))
    }

    func testDefaultSelectionFallsBackToTaskCreatedAtWhenUpdatedAtIsMissing() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [],
            sessions: [],
            tasks: [
                card("ghost", familiarId: "nova", projectId: "ghost", createdAt: iso(40)),
                card("alpha-task", familiarId: "nova", projectId: "alpha", createdAt: iso(10)),
                card("zulu-task", familiarId: "nova", projectId: "zulu", createdAt: iso(20)),
            ]
        )

        XCTAssertEqual(selection, .project(project("zulu", "Zulu")))
    }

    func testDefaultSelectionPrefersVisibleServerSessionProjectOverNewerTaskHistory() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [],
            sessions: [
                session(
                    "alpha-session",
                    familiarId: "nova",
                    projectRoot: "/repos/alpha",
                    updatedAt: iso(10)
                ),
            ],
            tasks: [
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(100)),
            ]
        )

        XCTAssertEqual(selection, .project(project("alpha", "Alpha")))
    }

    func testDefaultSelectionPrefersLocalThreadProjectOverNewerVisibleServerSession() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [
                thread(
                    "Alpha local",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/alpha",
                    updatedAt: Date(timeIntervalSince1970: 1)
                ),
            ],
            sessions: [
                session(
                    "zulu-session",
                    familiarId: "nova",
                    projectRoot: "/repos/zulu",
                    updatedAt: iso(100)
                ),
            ],
            tasks: []
        )

        XCTAssertEqual(selection, .project(project("alpha", "Alpha")))
    }

    func testDefaultSelectionPrefersLocalThreadProjectOverNewerTaskHistory() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            threads: [
                thread(
                    "Alpha local",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/alpha",
                    updatedAt: Date(timeIntervalSince1970: 1)
                ),
            ],
            sessions: [],
            tasks: [
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(100)),
            ]
        )

        XCTAssertEqual(selection, .project(project("alpha", "Alpha")))
    }

    func testDefaultSelectionUsesAlphabeticalRegisteredProjectBeforeUnassignedFallback() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [
                project("zulu", "Zulu"),
                project("alpha", "Alpha"),
            ],
            threads: [],
            sessions: [session("session", familiarId: "nova", projectRoot: nil)],
            tasks: [card("task", familiarId: "nova", projectId: nil)]
        )

        XCTAssertEqual(selection, .project(project("alpha", "Alpha")))
    }

    func testDefaultSelectionUsesUnassignedOnlyWhenNoRegisteredFallbackExists() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [],
            threads: [thread("Offline", familiarIds: ["nova"], projectRoot: nil)],
            sessions: [session("session", familiarId: "sage", projectRoot: nil)],
            tasks: [card("task", familiarId: "ember", projectId: nil)]
        )

        XCTAssertEqual(selection, .unassigned)
    }

    func testDefaultSelectionTreatsDeletedTaskProjectsAsUnassignedWhenCatalogIsEmpty() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [],
            threads: [],
            sessions: [],
            tasks: [card("task", familiarId: "ember", projectId: "deleted-project")]
        )

        XCTAssertEqual(selection, .unassigned)
    }

    func testDefaultSelectionReturnsNilWithoutRegisteredOrUnassignedArtifacts() {
        let selection = ProjectContext.defaultSelection(
            restored: nil,
            projects: [],
            threads: [],
            sessions: [],
            tasks: []
        )

        XCTAssertNil(selection)
    }

    func testProjectScopeNormalizesThreadAndSessionRootsBeforeMatching() {
        let context = ProjectContext.project(project("windows", "Windows", root: "C:/repos/cave"))

        XCTAssertTrue(
            context.matches(
                thread: thread("Thread", familiarIds: ["nova"], projectRoot: "C:\\repos\\cave\\")
            )
        )
        XCTAssertTrue(
            context.matches(
                session: session("session", familiarId: "nova", projectRoot: "C:\\repos\\cave\\")
            )
        )
    }

    func testProjectScopeResolvesWorktreeRootsBackToRegisteredProject() {
        let context = ProjectContext.project(project("cave", "Cave"))

        XCTAssertTrue(context.matches(thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/repos/cave")))
        XCTAssertTrue(context.matches(thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/repos/cave/")))
        XCTAssertTrue(
            context.matches(
                thread: thread(
                    "Thread",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feat-cave/"
                )
            )
        )
        XCTAssertFalse(context.matches(thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/repos/cave/child")))
        XCTAssertFalse(
            context.matches(
                thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/repos/cave/.worktrees")
            )
        )
        XCTAssertTrue(context.matches(session: session("session", familiarId: "nova", projectRoot: "/repos/cave")))
        XCTAssertTrue(
            context.matches(
                session: session(
                    "session",
                    familiarId: "nova",
                    projectRoot: "/repos/cave/.worktrees/feat-cave/inner"
                )
            )
        )
        XCTAssertFalse(context.matches(session: session("session", familiarId: "nova", projectRoot: nil)))
    }

    func testRegisteredProjectScopeAssignsNestedProjectAndWorktreeToSingleWinningContext() {
        let parent = project("parent", "Parent", root: "/repos/cave")
        let nested = project("nested", "Nested", root: "/repos/cave/.worktrees/feature")
        let registeredProjects = [parent, nested]
        let parentContext = ProjectContext.project(parent)
        let nestedContext = ProjectContext.project(nested)

        XCTAssertFalse(
            parentContext.matches(
                thread: thread(
                    "Nested project thread",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feature"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertTrue(
            nestedContext.matches(
                thread: thread(
                    "Nested project thread",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feature"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertFalse(
            parentContext.matches(
                thread: thread(
                    "Nested worktree thread",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertTrue(
            nestedContext.matches(
                thread: thread(
                    "Nested worktree thread",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix"
                ),
                registeredProjects: registeredProjects
            )
        )

        XCTAssertFalse(
            parentContext.matches(
                session: session(
                    "nested-project-session",
                    familiarId: "nova",
                    projectRoot: "/repos/cave/.worktrees/feature"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertTrue(
            nestedContext.matches(
                session: session(
                    "nested-project-session",
                    familiarId: "nova",
                    projectRoot: "/repos/cave/.worktrees/feature"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertFalse(
            parentContext.matches(
                session: session(
                    "nested-worktree-session",
                    familiarId: "nova",
                    projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix/inner"
                ),
                registeredProjects: registeredProjects
            )
        )
        XCTAssertTrue(
            nestedContext.matches(
                session: session(
                    "nested-worktree-session",
                    familiarId: "nova",
                    projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix/inner"
                ),
                registeredProjects: registeredProjects
            )
        )
    }

    func testProjectScopeRejectsTraversalLikeWorktreeRoots() {
        let context = ProjectContext.project(project("alpha", "Alpha", root: "/work/alpha"))

        XCTAssertFalse(
            context.matches(
                thread: thread(
                    "Traversal slash",
                    familiarIds: ["nova"],
                    projectRoot: "/work/alpha/.worktrees/feat-x/../../escape"
                )
            )
        )
        XCTAssertFalse(
            context.matches(
                session: session(
                    "session",
                    familiarId: "nova",
                    projectRoot: "\\work\\alpha\\.worktrees\\feat-x\\..\\..\\escape"
                )
            )
        )
    }

    func testProjectScopeKeepsFilesystemRootWorktreeHandling() {
        let context = ProjectContext.project(project("root", "Root", root: "/"))

        XCTAssertTrue(
            context.matches(
                thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/.worktrees/feat-root/")
            )
        )
        XCTAssertTrue(
            context.matches(
                session: session(
                    "session",
                    familiarId: "nova",
                    projectRoot: "/.worktrees/feat-root/inner"
                )
            )
        )
        XCTAssertFalse(
            context.matches(
                thread: thread("Thread", familiarIds: ["nova"], projectRoot: "/.worktrees")
            )
        )
    }

    func testProjectScopeMatchesTaskProjectIdsExactly() {
        let context = ProjectContext.project(project("cave", "Cave"))
        let projects = [project("cave", "Cave")]

        XCTAssertTrue(
            context.matches(
                task: card("task", familiarId: "nova", projectId: "cave"),
                registeredProjects: projects
            )
        )
        XCTAssertFalse(
            context.matches(
                task: card("task", familiarId: "nova", projectId: "docs"),
                registeredProjects: projects
            )
        )
        XCTAssertFalse(
            context.matches(
                task: card("task", familiarId: "nova", projectId: " cave "),
                registeredProjects: projects
            )
        )
    }

    func testUnassignedScopeMatchesNilAndEmptyProjectFields() {
        let context = ProjectContext.unassigned
        let projects = [project("cave", "Cave")]

        XCTAssertTrue(
            context.matches(
                thread: thread("Offline", familiarIds: ["nova"], projectRoot: nil),
                registeredProjects: projects
            )
        )
        XCTAssertTrue(
            context.matches(
                thread: thread("Offline", familiarIds: ["nova"], projectRoot: "  "),
                registeredProjects: projects
            )
        )
        XCTAssertFalse(
            context.matches(
                thread: thread("Bound", familiarIds: ["nova"], projectRoot: "/repos/cave"),
                registeredProjects: projects
            )
        )

        XCTAssertTrue(
            context.matches(
                session: session("session", familiarId: "sage", projectRoot: nil),
                registeredProjects: projects
            )
        )
        XCTAssertTrue(
            context.matches(
                session: session("session", familiarId: "sage", projectRoot: ""),
                registeredProjects: projects
            )
        )
        XCTAssertFalse(
            context.matches(
                session: session("session", familiarId: "sage", projectRoot: "/repos/cave"),
                registeredProjects: projects
            )
        )

        XCTAssertTrue(context.matches(task: card("task", familiarId: "ember", projectId: nil)))
        XCTAssertTrue(context.matches(task: card("task", familiarId: "ember", projectId: " ")))
        XCTAssertFalse(context.matches(task: card("task", familiarId: "ember", projectId: "cave")))
        XCTAssertTrue(
            context.matches(
                task: card("task", familiarId: "ember", projectId: "deleted-project"),
                registeredProjects: projects
            )
        )
    }

    func testUnassignedScopeMatchesUnregisteredAndTraversalRootsAgainstRegisteredProjects() {
        let context = ProjectContext.unassigned
        let projects = [project("cave", "Cave")]

        XCTAssertTrue(
            context.matches(
                thread: thread("Unknown", familiarIds: ["nova"], projectRoot: "/repos/ghost"),
                registeredProjects: projects
            )
        )
        XCTAssertTrue(
            context.matches(
                thread: thread(
                    "Orphan worktree",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/ghost/.worktrees/feat-ghost"
                ),
                registeredProjects: projects
            )
        )
        XCTAssertTrue(
            context.matches(
                thread: thread(
                    "Traversal",
                    familiarIds: ["nova"],
                    projectRoot: "/repos/cave/.worktrees/feat-cave/../../escape"
                ),
                registeredProjects: projects
            )
        )
        XCTAssertTrue(
            context.matches(
                session: session(
                    "session",
                    familiarId: "sage",
                    projectRoot: "\\repos\\ghost\\.worktrees\\feat-ghost\\..\\..\\escape"
                ),
                registeredProjects: projects
            )
        )
    }

    func testUnassignedFamiliarIDsIncludeOnlyUnassignedArtifacts() {
        let ids = ProjectContext.unassignedFamiliarIDs(
            threads: [
                thread("Offline", familiarIds: ["nova", "sage"], projectRoot: nil),
                thread("Unknown", familiarIds: ["lyra"], projectRoot: "/repos/ghost"),
                thread(
                    "Traversal",
                    familiarIds: ["moss"],
                    projectRoot: "/repos/cave/.worktrees/feat-cave/../../escape"
                ),
                thread("Bound", familiarIds: ["ember"], projectRoot: "/repos/cave"),
            ],
            sessions: [
                session("projectless-session", familiarId: "nyx", projectRoot: ""),
                session(
                    "orphan-worktree-session",
                    familiarId: "sol",
                    projectRoot: "/repos/ghost/.worktrees/feat-ghost"
                ),
                session("bound-session", familiarId: "ember", projectRoot: "/repos/cave"),
                session("blank-session", familiarId: " ", projectRoot: nil),
            ],
            tasks: [
                card("projectless-task", familiarId: "moss", projectId: nil),
                card("deleted-project-task", familiarId: "rune", projectId: "deleted-project"),
                card("bound-task", familiarId: "ember", projectId: "cave"),
                card("blank-task", familiarId: "", projectId: ""),
            ],
            registeredProjects: [project("cave", "Cave")]
        )

        XCTAssertEqual(ids, ["nova", "sage", "lyra", "moss", "nyx", "sol", "rune"])
    }
}
