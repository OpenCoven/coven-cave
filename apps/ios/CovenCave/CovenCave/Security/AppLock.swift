import Foundation
import Observation

/// Pure, dependency-free lock/re-lock decision so the 60-second grace window
/// is trivially testable without spinning up a whole `AppLock`.
enum AppLockPolicy {
    /// Quick app switches under this stay unlocked; anything at or beyond it
    /// re-locks on return to the foreground.
    static let graceInterval: TimeInterval = 60

    /// Whether returning to the foreground should (re)lock the app.
    /// - Parameters:
    ///   - enabled: Whether the "require biometrics to unlock" preference is on.
    ///   - alreadyLocked: Whether the app is currently locked (e.g. cold start,
    ///     or a previous background stint already locked it and unlock hasn't
    ///     happened since).
    ///   - backgroundDuration: Seconds spent backgrounded before returning, or
    ///     `nil` if the app never left the foreground (only `.inactive`, which
    ///     callers must not report here — see `AppLock.sceneDidEnterBackground`).
    static func shouldLock(enabled: Bool, alreadyLocked: Bool, backgroundDuration: TimeInterval?) -> Bool {
        guard enabled else { return false }
        if alreadyLocked { return true }
        guard let backgroundDuration else { return false }
        return backgroundDuration >= graceInterval
    }
}

/// App-wide lock/approval controller. Owns two persisted preferences
/// ("require biometrics to unlock" and "…for approvals") and the transient
/// `isLocked` state that gates the entire app's content at the root.
///
/// Dependency-injected authenticator, `UserDefaults` suite, and clock keep
/// this fully unit-testable without touching real biometrics or the wall
/// clock.
@Observable
@MainActor
final class AppLock {
    static let lockEnabledKey = "cave.security.lockEnabled"
    static let approvalEnabledKey = "cave.security.approvalEnabled"

    /// Whether the app root should show the full-screen lock instead of app
    /// content. Never a translucent overlay — the caller (`CovenCaveApp`)
    /// substitutes this for the entire window content while `true`.
    private(set) var isLocked: Bool
    private(set) var lockEnabled: Bool
    private(set) var approvalEnabled: Bool
    private(set) var biometricKind: BiometricKind
    /// Whether `.deviceOwnerAuthentication` (biometric or device passcode) is
    /// possible at all on this device. Both toggles are disabled in Settings
    /// when this is `false`.
    private(set) var canUseDeviceAuthentication: Bool
    /// Guards against stacked/duplicate LocalAuthentication prompts from
    /// overlapping calls (e.g. the lock screen's auto-prompt racing a manual
    /// retry tap).
    private(set) var isAuthenticating = false

    private let authenticator: BiometricAuthenticating
    private let defaults: UserDefaults
    private let now: () -> Date
    private var backgroundedAt: Date?

    init(
        authenticator: BiometricAuthenticating = LAContextBiometricAuthenticator(),
        defaults: UserDefaults = .standard,
        now: @escaping () -> Date = Date.init
    ) {
        self.authenticator = authenticator
        self.defaults = defaults
        self.now = now

        let availability = authenticator.availability()
        canUseDeviceAuthentication = availability.canEvaluate
        biometricKind = availability.kind

        // Preferences are meaningless (and must not silently lock the user
        // out) if device-owner authentication isn't available at all.
        let startLockEnabled = availability.canEvaluate && defaults.bool(forKey: Self.lockEnabledKey)
        lockEnabled = startLockEnabled
        approvalEnabled = availability.canEvaluate && defaults.bool(forKey: Self.approvalEnabledKey)
        isLocked = startLockEnabled
    }

    var biometricLabel: String { biometricKind.label }
    var biometricSystemImage: String { biometricKind.systemImage }

    // MARK: - Scene lifecycle

    /// Call when the scene reaches `.background` — never for `.inactive`,
    /// which LocalAuthentication prompts (and the app switcher/control
    /// center) can trigger spuriously without the app actually backgrounding.
    func sceneDidEnterBackground() {
        guard lockEnabled else { return }
        backgroundedAt = now()
    }

    /// Call when the scene reaches `.active`. Re-locks only if a genuine
    /// background stint (not a bare `.inactive` blip) reached the grace
    /// window, or if the app was already locked (cold start / prior
    /// re-lock not yet cleared by a successful unlock).
    func sceneDidBecomeActive() {
        defer { backgroundedAt = nil }
        guard lockEnabled else { return }
        let duration = backgroundedAt.map { now().timeIntervalSince($0) }
        if AppLockPolicy.shouldLock(enabled: lockEnabled, alreadyLocked: isLocked, backgroundDuration: duration) {
            isLocked = true
        }
    }

    // MARK: - Unlock

    /// Attempts a fresh device-owner authentication to clear the lock.
    /// No-ops (returns `true`) if not currently locked; returns `false`
    /// without prompting if a prompt is already in flight.
    @discardableResult
    func unlock() async -> Bool {
        guard isLocked else { return true }
        guard !isAuthenticating else { return false }
        isAuthenticating = true
        let success = await authenticator.authenticate(reason: "Unlock Coven Cave with \(biometricLabel)")
        isAuthenticating = false
        if success { isLocked = false }
        return success
    }

    // MARK: - Approval (credential-affecting actions)

    /// Fresh authentication gate for approval-scoped actions (paired-desktop
    /// credential changes). Passes through immediately when approvals are
    /// disabled — never touches the authenticator in that case.
    func requestApproval(reason: String) async -> Bool {
        guard approvalEnabled else { return true }
        guard !isAuthenticating else { return false }
        isAuthenticating = true
        let success = await authenticator.authenticate(reason: reason)
        isAuthenticating = false
        return success
    }

    // MARK: - Settings toggles

    /// Enables/disables "require biometrics to unlock". Either direction
    /// requires a successful fresh authentication first; on failure/cancel
    /// the preference is left completely unchanged.
    @discardableResult
    func setLockEnabled(_ enabled: Bool) async -> Bool {
        guard canUseDeviceAuthentication else { return false }
        guard enabled != lockEnabled else { return true }
        guard !isAuthenticating else { return false }
        isAuthenticating = true
        let reason = enabled
            ? "Enable \(biometricLabel) to unlock Coven Cave"
            : "Disable \(biometricLabel) unlock"
        let success = await authenticator.authenticate(reason: reason)
        isAuthenticating = false
        guard success else { return false }

        lockEnabled = enabled
        defaults.set(enabled, forKey: Self.lockEnabledKey)
        if !enabled { isLocked = false }
        return true
    }

    /// Enables/disables "require biometrics for approvals". Same
    /// authenticate-first-then-commit contract as `setLockEnabled`.
    @discardableResult
    func setApprovalEnabled(_ enabled: Bool) async -> Bool {
        guard canUseDeviceAuthentication else { return false }
        guard enabled != approvalEnabled else { return true }
        guard !isAuthenticating else { return false }
        isAuthenticating = true
        let reason = enabled
            ? "Enable \(biometricLabel) for approvals"
            : "Disable \(biometricLabel) approvals"
        let success = await authenticator.authenticate(reason: reason)
        isAuthenticating = false
        guard success else { return false }

        approvalEnabled = enabled
        defaults.set(enabled, forKey: Self.approvalEnabledKey)
        return true
    }
}
