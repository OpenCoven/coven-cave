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

/// Pure decision logic for whether the lock screen should fire an automatic
/// authentication attempt on scene activation. Extracted from
/// `LockScreenView` so the de-duplication rule is unit-testable without
/// SwiftUI: a genuine lock presentation gets exactly one automatic prompt,
/// and the `.inactive -> .active` bounce that presenting the
/// LocalAuthentication sheet itself causes must never be mistaken for a
/// second, fresh presentation.
struct LockScreenAutoPromptCoordinator {
    private var hasPromptedForCurrentPresentation = false

    /// Call whenever a new genuine lock presentation begins (cold start
    /// locked, or a real re-lock decision on `.active`) so the next
    /// activation prompts again exactly once.
    mutating func presentationBegan() {
        hasPromptedForCurrentPresentation = false
    }

    /// Call on every scene activation while (potentially) locked. Returns
    /// whether this activation should trigger an automatic authentication
    /// attempt; consumes the "may auto-prompt" state for the current
    /// presentation so repeat activations (including the bounce the prompt
    /// itself causes) don't re-fire until `presentationBegan()` runs again.
    mutating func shouldAutoPrompt(isLocked: Bool) -> Bool {
        guard isLocked, !hasPromptedForCurrentPresentation else { return false }
        hasPromptedForCurrentPresentation = true
        return true
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
    /// Opaque privacy shield, independent of `isLocked`. Raised immediately on
    /// `.inactive`/`.background` (app switcher, control center, an incoming
    /// call, or a bounced LocalAuthentication sheet) so a snapshot never
    /// exposes content, and cleared on a genuine `.active`. Unlike
    /// `isLocked`, this never gates authentication and never affects the
    /// 60-second re-lock clock — a quick inactive/active blip must not
    /// destroy navigation state by unmounting the root.
    private(set) var isPrivacyShielded = false
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
    private var autoPromptCoordinator = LockScreenAutoPromptCoordinator()

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
        if startLockEnabled { autoPromptCoordinator.presentationBegan() }
    }

    var biometricLabel: String { biometricKind.label }
    var biometricSystemImage: String { biometricKind.systemImage }

    // MARK: - Scene lifecycle

    /// Call when the scene reaches `.inactive` (app switcher, control
    /// center, an incoming call banner, or the `.inactive -> .active` bounce
    /// a LocalAuthentication sheet itself causes). Immediately raises the
    /// privacy shield so no content is visible in a snapshot, but —
    /// deliberately unlike `.background` — never touches `isLocked`, never
    /// starts/extends the 60s background clock, and never refreshes
    /// availability or consumes an auto-prompt slot: a quick inactive/active
    /// blip must not force re-authentication or restart the grace window.
    func sceneDidBecomeInactive() {
        isPrivacyShielded = true
    }

    /// Call when the scene reaches `.background`. Always ensures the privacy
    /// shield is up (belt-and-suspenders alongside `.inactive`, and the only
    /// shield trigger when a scene backgrounds without an observed
    /// `.inactive` first), but only starts the re-lock clock when locking is
    /// actually enabled.
    func sceneDidEnterBackground() {
        isPrivacyShielded = true
        guard lockEnabled else { return }
        backgroundedAt = now()
    }

    /// Call when the scene reaches `.active`. Refreshes live authentication
    /// availability/kind first (enrollment or passcode can change while
    /// backgrounded), reconciles the effective lock/approval preferences
    /// against that availability, then runs the existing re-lock decision —
    /// re-locking only if a genuine background stint (not a bare `.inactive`
    /// blip) reached the grace window, or if the app was already locked
    /// (cold start / prior re-lock not yet cleared by a successful unlock).
    /// The privacy shield is cleared last, once the correct `isLocked` state
    /// is settled.
    func sceneDidBecomeActive() {
        defer {
            backgroundedAt = nil
            isPrivacyShielded = false
        }
        refreshAvailability()
        guard lockEnabled else { return }
        let duration = backgroundedAt.map { now().timeIntervalSince($0) }
        let wasLocked = isLocked
        if AppLockPolicy.shouldLock(enabled: lockEnabled, alreadyLocked: isLocked, backgroundDuration: duration) {
            isLocked = true
            // Only a fresh false -> true transition is a new genuine lock
            // presentation; re-affirming an already-locked state (the
            // `alreadyLocked` branch above) must not grant another
            // automatic prompt — the retry button stays the only retry.
            if !wasLocked { autoPromptCoordinator.presentationBegan() }
        }
    }

    /// Re-checks `.deviceOwnerAuthentication` availability/kind and
    /// reconciles the effective `lockEnabled`/`approvalEnabled` against the
    /// *persisted* preferences so the UI stays truthful without losing the
    /// user's actual choice. When device-owner authentication is
    /// unavailable, effective toggles go false and any lock is cleared so
    /// the user is never stranded with no way to authenticate; the
    /// persisted preferences themselves are left untouched so they restore
    /// automatically once availability returns.
    private func refreshAvailability() {
        let availability = authenticator.availability()
        canUseDeviceAuthentication = availability.canEvaluate
        biometricKind = availability.kind

        lockEnabled = canUseDeviceAuthentication && defaults.bool(forKey: Self.lockEnabledKey)
        approvalEnabled = canUseDeviceAuthentication && defaults.bool(forKey: Self.approvalEnabledKey)
        if !canUseDeviceAuthentication {
            isLocked = false
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

    /// Called by `LockScreenView` on every scene activation. Fires at most
    /// one automatic authentication attempt per genuine lock presentation:
    /// the `.inactive -> .active` bounce a cancelled/failed LocalAuthentication
    /// sheet itself causes is deliberately *not* treated as a new
    /// presentation, so it never re-triggers a prompt — the explicit retry
    /// button remains the only way to retry until the next genuine lock
    /// cycle begins.
    @discardableResult
    func autoPromptOnActive() async -> Bool {
        guard autoPromptCoordinator.shouldAutoPrompt(isLocked: isLocked) else { return false }
        return await unlock()
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

    /// Gates an arbitrary async action behind `requestApproval`, running it
    /// only when approved (approvals disabled, or a fresh authentication
    /// succeeded). Centralizes the "authenticate, then act, else leave
    /// everything alone" pattern so callers like Settings' credential-
    /// affecting operations (host change, disconnect) don't duplicate the
    /// guard/return dance — they just branch on the returned `Bool` to show
    /// their own failure alert.
    @discardableResult
    func performApprovedAction(reason: String, action: () async -> Void) async -> Bool {
        guard await requestApproval(reason: reason) else { return false }
        await action()
        return true
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
