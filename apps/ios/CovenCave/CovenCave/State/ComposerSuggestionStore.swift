import Foundation
import Observation

/// Skills and prompt templates for the composer's argument pickers (#5876),
/// and the project file index for `@` mentions in a one-to-one chat (#6104).
///
/// Loaded on demand, the first time a `/skill` or `/prompt` picker opens, and
/// reused for a few minutes so typing never waits on the network. Each kind
/// loads once at a time; a second caller joins the first. The cache belongs to
/// one host: pointing the app at another desktop drops it. The file index
/// holds one project root at a time and goes stale sooner, because files
/// change while the user works; a stale index stays visible while it reloads.
@Observable
@MainActor
final class ComposerSuggestionStore {
    enum Kind: Hashable { case skills, prompts }
    enum LoadState: Equatable { case idle, loading, loaded, failed }

    private(set) var skills: [SkillOption] = []
    private(set) var prompts: [PromptOption] = []
    private(set) var state: [Kind: LoadState] = [:]

    @ObservationIgnored private var host: String?
    @ObservationIgnored private var loadedAt: [Kind: Date] = [:]
    @ObservationIgnored private var inFlight: [Kind: Task<Void, Never>] = [:]
    @ObservationIgnored private let now: () -> Date
    static let freshFor: TimeInterval = 5 * 60

    /// Repo-relative files under `projectFilesRoot` (`GET /api/project/files`).
    private(set) var projectFiles: [String] = []
    private(set) var projectFilesRoot: String?
    private(set) var projectFilesState: LoadState = .idle
    @ObservationIgnored private var projectFilesLoadedAt: Date?
    @ObservationIgnored private var projectFilesTask: (root: String, task: Task<Void, Never>)?
    static let projectFilesFreshFor: TimeInterval = 60

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    func loadState(_ kind: Kind) -> LoadState { state[kind] ?? .idle }

    /// Load `kind` unless a fresh copy is cached or a load is already running.
    func ensureLoaded(
        _ kind: Kind,
        host: String?,
        skills loadSkills: @escaping @Sendable () async throws -> [SkillOption],
        prompts loadPrompts: @escaping @Sendable () async throws -> [PromptOption]
    ) async {
        if host != self.host {
            reset()
            self.host = host
        }
        if let at = loadedAt[kind], now().timeIntervalSince(at) < Self.freshFor { return }
        if let running = inFlight[kind] {
            await running.value
            return
        }
        state[kind] = .loading
        let task = Task { [weak self] in
            do {
                switch kind {
                case .skills:
                    let rows = SkillInvocation.dedupe(try await loadSkills())
                    self?.finish(kind, host: host) { $0.skills = rows }
                case .prompts:
                    let rows = try await loadPrompts()
                    self?.finish(kind, host: host) { $0.prompts = rows }
                }
            } catch {
                self?.fail(kind, host: host)
            }
        }
        inFlight[kind] = task
        await task.value
    }

    /// The cached files for `root`; none while another root's index is held.
    func files(for root: String) -> [String] {
        projectFilesRoot == root ? projectFiles : []
    }

    /// Load the file index for `root` unless a fresh copy is cached or that
    /// root is already loading. Switching roots drops the previous index.
    func ensureProjectFiles(
        root: String,
        host: String?,
        load: @escaping @Sendable (String) async throws -> [String]
    ) async {
        if host != self.host {
            reset()
            self.host = host
        }
        if projectFilesRoot == root, let at = projectFilesLoadedAt,
           now().timeIntervalSince(at) < Self.projectFilesFreshFor { return }
        if let running = projectFilesTask, running.root == root {
            await running.task.value
            return
        }
        projectFilesTask?.task.cancel()
        if projectFilesRoot != root {
            projectFiles = []
            projectFilesRoot = root
            projectFilesLoadedAt = nil
        }
        projectFilesState = .loading
        let task = Task { [weak self] in
            do {
                let files = try await load(root)
                self?.finishProjectFiles(root: root, host: host, files: files)
            } catch {
                self?.failProjectFiles(root: root, host: host)
            }
        }
        projectFilesTask = (root, task)
        await task.value
    }

    /// Seed a project's files without a request: previews and tests.
    func seedProjectFiles(_ files: [String], root: String) {
        projectFilesTask?.task.cancel()
        projectFilesTask = nil
        projectFiles = files
        projectFilesRoot = root
        projectFilesLoadedAt = now()
        projectFilesState = .loaded
    }

    /// Seed rows without a request: previews and tests.
    func seed(skills: [SkillOption], prompts: [PromptOption], host: String? = nil) {
        reset()
        self.host = host
        self.skills = SkillInvocation.dedupe(skills)
        self.prompts = prompts
        let at = now()
        loadedAt = [.skills: at, .prompts: at]
        state = [.skills: .loaded, .prompts: .loaded]
    }

    private func finish(_ kind: Kind, host: String?, apply: (ComposerSuggestionStore) -> Void) {
        inFlight[kind] = nil
        guard host == self.host else { return }
        apply(self)
        loadedAt[kind] = now()
        state[kind] = .loaded
    }

    private func fail(_ kind: Kind, host: String?) {
        inFlight[kind] = nil
        guard host == self.host else { return }
        state[kind] = .failed
    }

    private func finishProjectFiles(root: String, host: String?, files: [String]) {
        guard host == self.host, root == projectFilesRoot else { return }
        projectFilesTask = nil
        projectFiles = files
        projectFilesLoadedAt = now()
        projectFilesState = .loaded
    }

    private func failProjectFiles(root: String, host: String?) {
        guard host == self.host, root == projectFilesRoot else { return }
        projectFilesTask = nil
        projectFilesState = .failed
    }

    private func reset() {
        for task in inFlight.values { task.cancel() }
        inFlight = [:]
        skills = []
        prompts = []
        loadedAt = [:]
        state = [:]
        projectFilesTask?.task.cancel()
        projectFilesTask = nil
        projectFiles = []
        projectFilesRoot = nil
        projectFilesLoadedAt = nil
        projectFilesState = .idle
    }
}
