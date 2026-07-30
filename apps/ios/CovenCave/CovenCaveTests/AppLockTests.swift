import XCTest
@testable import CovenCave

/// A small controllable fake — never a test-only production hook. Records
/// how many times authentication was actually invoked so tests can assert
/// approval bypass and prompt de-duplication.
private final class FakeBiometricAuthenticator: BiometricAuthenticating {
    var canEvaluate = true
    var kind: BiometricKind = .faceID
    var authenticateResult = true
    private(set) var authenticateCallCount = 0

    func availability() -> (canEvaluate: Bool, kind: BiometricKind) {
        (canEvaluate, kind)
    }

    func authenticate(reason: String) async -> Bool {
        authenticateCallCount += 1
        return authenticateResult
    }
}

/// Controllable clock so background-duration boundaries (the 60s grace
/// window) are deterministic instead of racing a real timer.
private final class TestClock {
    var current: TimeInterval
    init(_ current: TimeInterval = 0) { self.current = current }
    func now() -> TimeInterval { current }
    func advance(by seconds: TimeInterval) { current += seconds }
}

@MainActor
final class AppLockTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suiteName = "AppLockTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeLock(
        lockEnabled: Bool = false,
        approvalEnabled: Bool = false,
        authenticator: FakeBiometricAuthenticator = FakeBiometricAuthenticator(),
        clock: TestClock = TestClock()
    ) -> AppLock {
        defaults.set(lockEnabled, forKey: AppLock.lockEnabledKey)
        defaults.set(approvalEnabled, forKey: AppLock.approvalEnabledKey)
        return AppLock(authenticator: authenticator, defaults: defaults, monotonicNow: clock.now)
    }

    // MARK: - Cold start

    func testDisabledPolicyDoesNotLockAtColdStart() {
        let lock = makeLock(lockEnabled: false)
        XCTAssertFalse(lock.isLocked)
    }

    func testEnabledColdStartLocks() {
        let lock = makeLock(lockEnabled: true)
        XCTAssertTrue(lock.isLocked)
    }

    func testDisabledPolicyStaysUnlockedAcrossBackgrounding() {
        let clock = TestClock()
        let lock = makeLock(lockEnabled: false, clock: clock)
        lock.sceneDidEnterBackground()
        clock.advance(by: 600)
        lock.sceneDidBecomeActive()
        XCTAssertFalse(lock.isLocked)
    }

    // MARK: - Grace boundary

    func testQuickSwitchUnderSixtySecondsStaysUnlocked() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        // Cold start locks; unlock once so we can observe the re-lock decision
        // in isolation from the initial cold-start lock.
        _ = await lock.unlock()
        XCTAssertFalse(lock.isLocked)

        lock.sceneDidEnterBackground()
        clock.advance(by: 59)
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isLocked)
    }

    func testAtSixtySecondGraceBoundaryLocks() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()
        XCTAssertFalse(lock.isLocked)

        lock.sceneDidEnterBackground()
        clock.advance(by: 60)
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.isLocked)
    }

    func testMonotonicClockRollbackLocksConservatively() async {
        let clock = TestClock(100)
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.current = 50
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.isLocked)
    }

    // MARK: - Unlock

    func testSuccessfulUnlockClearsTheLock() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        XCTAssertTrue(lock.isLocked)

        let result = await lock.unlock()

        XCTAssertTrue(result)
        XCTAssertFalse(lock.isLocked)
    }

    func testFailedUnlockLeavesTheLockInPlace() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        XCTAssertTrue(lock.isLocked)

        let result = await lock.unlock()

        XCTAssertFalse(result)
        XCTAssertTrue(lock.isLocked)
    }

    // MARK: - Approval

    func testApprovalDisabledBypassesTheAuthenticatorEntirely() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: false, approvalEnabled: false, authenticator: authenticator)

        let approved = await lock.requestApproval(reason: "Change host")

        XCTAssertTrue(approved)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    func testApprovalEnabledReturnsAuthenticatorSuccess() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, approvalEnabled: true, authenticator: authenticator)

        let approved = await lock.requestApproval(reason: "Disconnect")

        XCTAssertTrue(approved)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testApprovalEnabledReturnsAuthenticatorFailure() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: false, approvalEnabled: true, authenticator: authenticator)

        let approved = await lock.requestApproval(reason: "Disconnect")

        XCTAssertFalse(approved)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    // MARK: - Approved action (Settings' protected operations)

    func testPerformApprovedActionDoesNotExecuteActionWhenEnabledApprovalFails() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0

        let approved = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertFalse(approved)
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testPerformApprovedActionExecutesActionExactlyOnceWhenEnabledApprovalSucceeds() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0

        let approved = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertTrue(approved)
        XCTAssertEqual(executionCount, 1)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testPerformApprovedActionExecutesActionExactlyOnceWhenApprovalsDisabledWithoutTouchingAuthenticator() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)
        var executionCount = 0

        let approved = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertTrue(approved)
        XCTAssertEqual(executionCount, 1)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    // MARK: - Toggle gating

    func testEnablingLockOnlyTakesEffectAfterSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let ok = await lock.setLockEnabled(true)

        XCTAssertTrue(ok)
        XCTAssertTrue(lock.lockEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testEnablingLockDoesNotChangeAnythingWhenAuthenticationFails() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let ok = await lock.setLockEnabled(true)

        XCTAssertFalse(ok)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testDisablingLockAlsoRequiresSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        let ok = await lock.setLockEnabled(false)

        XCTAssertFalse(ok)
        XCTAssertTrue(lock.lockEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testDisablingLockSucceedsAfterSuccessfulAuthenticationAndUnlocksImmediately() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        XCTAssertTrue(lock.isLocked)

        let ok = await lock.setLockEnabled(false)

        XCTAssertTrue(ok)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(lock.isLocked)
    }

    func testEnablingApprovalOnlyTakesEffectAfterSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)

        let ok = await lock.setApprovalEnabled(true)

        XCTAssertTrue(ok)
        XCTAssertTrue(lock.approvalEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.approvalEnabledKey))
    }

    func testDisablingApprovalRequiresSuccessfulAuthenticationTooAndLeavesUnchangedOnFailure() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)

        let ok = await lock.setApprovalEnabled(false)

        XCTAssertFalse(ok)
        XCTAssertTrue(lock.approvalEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.approvalEnabledKey))
    }

    // MARK: - Unavailable device authentication

    func testTogglesAreRejectedWhenDeviceOwnerAuthenticationIsUnavailable() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.canEvaluate = false
        authenticator.kind = .none
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        XCTAssertFalse(lock.canUseDeviceAuthentication)

        let ok = await lock.setLockEnabled(true)

        XCTAssertFalse(ok)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    // MARK: - Auto-prompt de-duplication (lock screen `.active` lifecycle)

    /// Cold start locked: the first scene activation should trigger exactly
    /// one automatic authentication attempt.
    func testAutoPromptOnActiveFiresOnceOnColdStart() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        let result = await lock.autoPromptOnActive()

        XCTAssertTrue(result)
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    /// Reproduces the reported defect: LocalAuthentication sheets can bounce
    /// the scene `.active -> .inactive -> .active`. After the user cancels
    /// or fails, that bounce's resulting `.active` must NOT trigger a second
    /// automatic prompt — only the explicit retry button may retry.
    func testAutoPromptDoesNotRepeatAfterCancellationFromInactiveActiveBounce() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        let first = await lock.autoPromptOnActive()
        XCTAssertFalse(first)
        XCTAssertTrue(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)

        // Simulates the `.inactive -> .active` bounce the cancelled/failed
        // LocalAuthentication sheet itself causes: the view's `.task(id:
        // scenePhase)` re-runs, calling this again with no genuine new lock
        // cycle in between.
        let second = await lock.autoPromptOnActive()
        XCTAssertFalse(second)
        XCTAssertTrue(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 1, "must not stack/repeat an automatic prompt")
    }

    /// The explicit retry button (which calls `unlock()` directly, not the
    /// auto-prompt path) must keep working after the auto-prompt has
    /// declined to fire again.
    func testExplicitRetryStillWorksAfterAutoPromptDeclines() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        _ = await lock.autoPromptOnActive()
        XCTAssertEqual(authenticator.authenticateCallCount, 1)

        // A second bounce still must not auto-prompt.
        _ = await lock.autoPromptOnActive()
        XCTAssertEqual(authenticator.authenticateCallCount, 1)

        // But the user tapping the retry button directly always works.
        authenticator.authenticateResult = true
        let retried = await lock.unlock()

        XCTAssertTrue(retried)
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 2)
    }

    /// A new genuine lock cycle (re-locking after the grace window elapses)
    /// must get its own fresh automatic prompt.
    func testAutoPromptFiresAgainForANewGenuineLockCycle() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)

        _ = await lock.autoPromptOnActive()
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)

        lock.sceneDidEnterBackground()
        clock.advance(by: 60)
        lock.sceneDidBecomeActive()
        XCTAssertTrue(lock.isLocked)

        let result = await lock.autoPromptOnActive()

        XCTAssertTrue(result)
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.authenticateCallCount, 2, "a new genuine lock cycle gets its own auto-prompt")
    }

    /// Two concurrent auto-prompt calls (e.g. a fast bounce racing the
    /// initial `.task`) must never both reach the authenticator.
    func testAutoPromptOnActiveNeverStacksConcurrentCalls() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        async let first = lock.autoPromptOnActive()
        async let second = lock.autoPromptOnActive()
        _ = await (first, second)

        XCTAssertEqual(authenticator.authenticateCallCount, 1)
        XCTAssertFalse(lock.isLocked)
    }

    // MARK: - Privacy shield (separate from the authentication lock)

    /// `.inactive` (app switcher / control center / a bounced LocalAuthentication
    /// sheet) must raise the privacy shield immediately, but must never mark
    /// `isLocked`, start the background clock, or consume an auto-prompt slot.
    func testInactiveEnablesPrivacyShieldWithoutLocking() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        _ = await lock.unlock()
        XCTAssertFalse(lock.isLocked)
        XCTAssertFalse(lock.isPrivacyShielded)

        lock.sceneDidBecomeInactive()

        XCTAssertTrue(lock.isPrivacyShielded)
        XCTAssertFalse(lock.isLocked)
    }

    /// A quick `.inactive -> .active` bounce with no genuine background stint
    /// must clear the shield without ever re-locking.
    func testQuickInactiveThenActiveClearsShieldWithoutLocking() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidBecomeInactive()
        XCTAssertTrue(lock.isPrivacyShielded)

        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isPrivacyShielded)
        XCTAssertFalse(lock.isLocked)
    }

    /// `.background` must raise the shield unconditionally, but only starts
    /// the re-lock clock when locking is actually enabled.
    func testBackgroundEnablesPrivacyShieldRegardlessOfLockEnabled() {
        let lock = makeLock(lockEnabled: false)

        lock.sceneDidEnterBackground()

        XCTAssertTrue(lock.isPrivacyShielded)
        XCTAssertFalse(lock.isLocked)
    }

    /// A background stint at/over the 60s grace window must clear the shield
    /// on return to `.active` even though the app is (correctly) left locked.
    func testGraceWindowExceededActiveClearsShieldButLeavesAppLocked() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        XCTAssertTrue(lock.isPrivacyShielded)
        clock.advance(by: 60)
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.isLocked)
        XCTAssertFalse(lock.isPrivacyShielded)
    }

    // MARK: - Live authentication availability refresh

    /// A genuine `.active` must re-check availability and refresh the
    /// reported kind — e.g. biometrics got un-enrolled but the device
    /// passcode fallback remains, so the label must become "Device Passcode".
    func testActiveRefreshesBiometricKindWhenHardwareChanges() {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.kind = .faceID
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)
        XCTAssertEqual(lock.biometricKind, .faceID)

        authenticator.kind = .none
        lock.sceneDidBecomeActive()

        XCTAssertEqual(lock.biometricKind, .none)
        XCTAssertEqual(lock.biometricLabel, "Device Passcode")
    }

    /// If device-owner authentication becomes entirely unavailable (no
    /// biometrics enrolled and no passcode set) while the app is
    /// backgrounded, the effective lock preference must go false and any
    /// lock must clear on `.active` — the user must never be stranded with
    /// no way to authenticate. The persisted preference itself must survive
    /// untouched so it can be restored later.
    func testUnavailableDeviceAuthenticationClearsEffectiveLockAndCannotStrandTheUser() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        _ = await lock.unlock()
        XCTAssertFalse(lock.isLocked)

        authenticator.canEvaluate = false
        authenticator.kind = .none
        lock.sceneDidEnterBackground()
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.canUseDeviceAuthentication)
        XCTAssertFalse(lock.lockEnabled, "effective lockEnabled must go false so the user isn't stranded")
        XCTAssertFalse(lock.isLocked, "must never re-lock the user out with no way to authenticate")
        XCTAssertTrue(
            defaults.bool(forKey: AppLock.lockEnabledKey),
            "persisted preference must survive a transient unavailability"
        )
    }

    /// Once availability returns, the effective preferences must be restored
    /// from the untouched persisted values rather than staying forced off.
    func testRestoredAvailabilityRestoresPersistedEffectivePreferences() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, approvalEnabled: true, authenticator: authenticator)
        _ = await lock.unlock()

        authenticator.canEvaluate = false
        authenticator.kind = .none
        lock.sceneDidBecomeActive()
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(lock.approvalEnabled)

        authenticator.canEvaluate = true
        authenticator.kind = .faceID
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.canUseDeviceAuthentication)
        XCTAssertTrue(lock.lockEnabled, "restored availability should restore the persisted effective preference")
        XCTAssertTrue(lock.approvalEnabled, "restored availability should restore the persisted effective preference")
        XCTAssertFalse(lock.isLocked, "a quick active with no background stint must not re-lock")
    }

    /// `.inactive` must never trigger the availability/kind refresh — only a
    /// genuine `.active` does.
    func testInactiveDoesNotRefreshAvailabilityOrKind() {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.kind = .faceID
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        authenticator.kind = .touchID
        authenticator.canEvaluate = false
        lock.sceneDidBecomeInactive()

        XCTAssertEqual(lock.biometricKind, .faceID, "inactive must not refresh availability")
        XCTAssertTrue(lock.canUseDeviceAuthentication, "inactive must not refresh availability")
        XCTAssertTrue(lock.isPrivacyShielded)
    }

    // MARK: - Pure policy

    func testAppLockPolicyGraceBoundary() {
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: false, alreadyLocked: false, backgroundDuration: 600))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: nil))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: 59))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: 60))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: true, backgroundDuration: 1))
    }
}
