import Foundation
import Observation

/// Skills and prompt templates for the composer's argument pickers (#5876).
///
/// Loaded on demand, the first time a `/skill` or `/prompt` picker opens, and
/// reused for a few minutes so typing never waits on the network. Each kind
/// loads once at a time; a second caller joins the first. The cache belongs to
/// one host: pointing the app at another desktop drops it.
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

    private func reset() {
        for task in inFlight.values { task.cancel() }
        inFlight = [:]
        skills = []
        prompts = []
        loadedAt = [:]
        state = [:]
    }
}
