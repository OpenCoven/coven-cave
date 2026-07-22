import Foundation

/// Transport outcome of one endpoint probe, shared by every caller that
/// joined it. Mirrors `AppModel.DiscoveryOutcome`, plus `.cancelled` so a
/// superseded probe (endpoint changed underneath it) can be recognised and
/// must never touch connection state.
enum ConnectionRefreshResult: Equatable, Sendable {
    case found(URL)
    case unauthorized
    case unreachable
    case cancelled
}

/// Collapses overlapping connection refreshes into one probe. The reconnect
/// signals all fire at once around a drop — foreground revalidation, the
/// NWPath monitor, the reconnect-pill ticker, a pill tap — and each used to
/// launch its own full discovery sweep. Here the first caller launches the
/// probe, every concurrent caller awaits the same task, and exactly one
/// caller (the launcher) is told to apply the outcome so state changes and
/// post-connect loads run once, not per caller.
actor ConnectionRefreshCoordinator {
    private var inFlight: Task<ConnectionRefreshResult, Never>?
    private var inFlightNonce: UInt64 = 0
    private var activeNonce: UInt64?
    /// Surface-reload intent accumulated onto the current in-flight probe by
    /// joiners. Only the launcher applies the outcome, so a joiner that wanted
    /// a full surface reload would otherwise have its intent silently dropped
    /// — instead it's OR-merged here and handed to the launcher on return.
    /// Reset at each launch: the flag belongs to that probe's cohort.
    private var pendingSurfaceReload = false

    func refresh(
        requestSurfaceReload: Bool = false,
        _ probe: @escaping @Sendable () async -> ConnectionRefreshResult
    ) async -> (result: ConnectionRefreshResult, launched: Bool, surfaceReloadRequested: Bool) {
        if let inFlight {
            if requestSurfaceReload { pendingSurfaceReload = true }
            return (await inFlight.value, false, false)
        }
        pendingSurfaceReload = false
        inFlightNonce &+= 1
        let nonce = inFlightNonce
        activeNonce = nonce
        let task = Task { await probe() }
        inFlight = task
        // Only clear our own task: a cancel + relaunch while we await must
        // not blow away the successor's in-flight slot.
        defer {
            // `return` is not allowed inside `defer`, so use `if` rather than `guard`.
            if activeNonce == nonce {
                inFlight = nil
                activeNonce = nil
            }
        }
        let result = await task.value
        // Joiners that piled onto this probe set the flag while `inFlight` was
        // still ours, which the actor serializes strictly before this resume —
        // so the read below cannot miss a joined caller's intent.
        return (result, true, requestSurfaceReload || pendingSurfaceReload)
    }

    /// Cancel the in-flight probe (if any) and clear the slot so the next
    /// refresh launches fresh — required when the endpoint is reconfigured,
    /// so the new configuration can't join a probe of the old one.
    func cancelActiveRefresh() {
        inFlight?.cancel()
        inFlight = nil
        activeNonce = nil
    }
}

// MARK: - Concurrent bootstrap

/// The three independent resources fetched after a successful probe. Each is
/// its own `Result` so one failure can't discard the others.
struct ConnectionBootstrapPayload {
    var familiars: Result<[Familiar], any Error>
    var theme: Result<ThemeSnapshot, any Error>
    var profile: Result<OperatorProfile, any Error>
}

enum ConnectionBootstrap {
    /// Fetch familiars, theme, and operator profile concurrently — wall time
    /// tracks the slowest loader instead of the sum of all three.
    static func load(using client: some CaveBootstrapClient) async -> ConnectionBootstrapPayload {
        async let familiars = Result.capturing { try await client.familiars() }
        async let theme = Result.capturing { try await client.fetchTheme() }
        async let profile = Result.capturing { try await client.operatorProfile() }
        return await ConnectionBootstrapPayload(
            familiars: familiars, theme: theme, profile: profile)
    }
}

extension Result where Failure == any Error {
    /// `Result(catching:)` for async bodies — the stdlib initializer is
    /// synchronous-only.
    static func capturing(_ body: @Sendable () async throws -> Success) async -> Result {
        do { return .success(try await body()) } catch { return .failure(error) }
    }
}
