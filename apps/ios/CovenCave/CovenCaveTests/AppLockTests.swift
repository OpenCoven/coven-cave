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
    /// When `true`, `authenticate` suspends (after recording the call) until
    /// `resumeSuspendedAuthenticate()` is invoked — simulating a real,
    /// still-on-screen LocalAuthentication prompt so busy-guard tests can
    /// deterministically observe `isAuthenticating`/`canBeginAuthentication`
    /// mid-flight.
    var suspendsAuthenticate = false
    /// Fired synchronously the instant `authenticate` is invoked (before
    /// suspending), so a test can `await fulfillment(of:)` an expectation
    /// instead of spin-polling `AppLock` state — a busy-poll loop on the
    /// same `@MainActor` executor as the in-flight call risks starving it.
    var onAuthenticateStart: (() -> Void)?
    private var pendingContinuation: CheckedContinuation<Void, Never>?

    func availability() -> (canEvaluate: Bool, kind: BiometricKind) {
        (canEvaluate, kind)
    }

    func authenticate(reason: String) async -> Bool {
        authenticateCallCount += 1
        onAuthenticateStart?()
        if suspendsAuthenticate {
            await withCheckedContinuation { continuation in
                pendingContinuation = continuation
            }
        }
        return authenticateResult
    }

    /// Lets a suspended `authenticate` call complete, as if the user had
    /// just finished (or the system delivered) the prompt.
    func resumeSuspendedAuthenticate() {
        pendingContinuation?.resume()
        pendingContinuation = nil
    }
}

/// Controllable clock so background-duration boundaries (the 60s grace
/// window) are deterministic instead of racing a real timer.
private final class TestClock {
    var current: ContinuousClock.Instant

    init(_ current: ContinuousClock.Instant = ContinuousClock().now) {
        self.current = current
    }

    func now() -> ContinuousClock.Instant { current }

    func advance(by seconds: TimeInterval) {
        current = current.advanced(by: .seconds(seconds))
    }
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
        return AppLock(authenticator: authenticator, defaults: defaults, continuousNow: clock.now)
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

    func testContinuousClockResetLocksConservatively() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.current = clock.current.advanced(by: .seconds(-50))
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

        let outcome = await lock.requestApproval(reason: "Change host")

        XCTAssertEqual(outcome, .authorized)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    func testApprovalEnabledReturnsAuthenticatorSuccess() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, approvalEnabled: true, authenticator: authenticator)

        let outcome = await lock.requestApproval(reason: "Disconnect")

        XCTAssertEqual(outcome, .authorized)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testApprovalEnabledReturnsAuthenticatorFailure() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: false, approvalEnabled: true, authenticator: authenticator)

        let outcome = await lock.requestApproval(reason: "Disconnect")

        XCTAssertEqual(outcome, .denied)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    // MARK: - Approved action (Settings' protected operations)

    func testPerformApprovedActionDoesNotExecuteActionWhenEnabledApprovalFails() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0

        let outcome = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertEqual(outcome, .denied)
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testPerformApprovedActionExecutesActionExactlyOnceWhenEnabledApprovalSucceeds() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0

        let outcome = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertEqual(outcome, .authorized)
        XCTAssertEqual(executionCount, 1)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testPerformApprovedActionExecutesActionExactlyOnceWhenApprovalsDisabledWithoutTouchingAuthenticator() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)
        var executionCount = 0

        let outcome = await lock.performApprovedAction(reason: "Disconnect") { executionCount += 1 }

        XCTAssertEqual(outcome, .authorized)
        XCTAssertEqual(executionCount, 1)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    func testEnabledApprovalFailsClosedWithoutExecutingWhenAuthenticationBecomesUnavailable() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0
        authenticator.canEvaluate = false
        authenticator.kind = .none

        let outcome = await lock.performApprovedAction(reason: "Replace pairing") {
            executionCount += 1
        }

        XCTAssertEqual(outcome, .unavailable)
        XCTAssertTrue(lock.approvalEnabled, "the user's persisted approval choice remains logically enabled")
        XCTAssertFalse(lock.canUseDeviceAuthentication)
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    func testRestoredAvailabilityStillRequiresApprovalAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        authenticator.canEvaluate = false
        authenticator.kind = .none
        let unavailable = await lock.requestApproval(reason: "Replace pairing")
        XCTAssertEqual(unavailable, .unavailable)

        authenticator.canEvaluate = true
        authenticator.kind = .faceID
        authenticator.authenticateResult = false
        let denied = await lock.requestApproval(reason: "Replace pairing")

        XCTAssertEqual(denied, .denied)
        XCTAssertTrue(lock.approvalEnabled)
        XCTAssertTrue(lock.canUseDeviceAuthentication)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)
    }

    func testDisabledPersistedApprovalPassesThroughWhenAuthenticationIsUnavailable() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.canEvaluate = false
        authenticator.kind = .none
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)
        var executionCount = 0

        let outcome = await lock.performApprovedAction(reason: "Initial pairing") {
            executionCount += 1
        }

        XCTAssertEqual(outcome, .authorized)
        XCTAssertFalse(lock.approvalEnabled)
        XCTAssertEqual(executionCount, 1)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    // MARK: - Toggle gating

    func testEnablingLockOnlyTakesEffectAfterSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let outcome = await lock.setLockEnabled(true)

        XCTAssertEqual(outcome, .authorized)
        XCTAssertTrue(lock.lockEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testEnablingLockDoesNotChangeAnythingWhenAuthenticationFails() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let outcome = await lock.setLockEnabled(true)

        XCTAssertEqual(outcome, .denied)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testDisablingLockAlsoRequiresSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)

        let outcome = await lock.setLockEnabled(false)

        XCTAssertEqual(outcome, .denied)
        XCTAssertTrue(lock.lockEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.lockEnabledKey))
    }

    func testDisablingLockSucceedsAfterSuccessfulAuthenticationAndUnlocksImmediately() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, authenticator: authenticator)
        XCTAssertTrue(lock.isLocked)

        let outcome = await lock.setLockEnabled(false)

        XCTAssertEqual(outcome, .authorized)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(lock.isLocked)
    }

    func testEnablingApprovalOnlyTakesEffectAfterSuccessfulAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)

        let outcome = await lock.setApprovalEnabled(true)

        XCTAssertEqual(outcome, .authorized)
        XCTAssertTrue(lock.approvalEnabled)
        XCTAssertTrue(defaults.bool(forKey: AppLock.approvalEnabledKey))
    }

    func testDisablingApprovalRequiresSuccessfulAuthenticationTooAndLeavesUnchangedOnFailure() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = false
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)

        let outcome = await lock.setApprovalEnabled(false)

        XCTAssertEqual(outcome, .denied)
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

        let outcome = await lock.setLockEnabled(true)

        XCTAssertEqual(outcome, .unavailable)
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

    // MARK: - Busy guard (concurrent taps while a prompt is in flight)

    /// `canBeginAuthentication` is the synchronous signal Settings/Connection
    /// use to disable controls and guard action handlers before spawning a
    /// `Task`. It must flip to `false` for the whole span `isAuthenticating`
    /// is `true` and back to `true` once the in-flight prompt resolves.
    func testCanBeginAuthenticationReflectsInFlightAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        XCTAssertTrue(lock.canBeginAuthentication)

        let started = expectation(description: "first prompt started")
        authenticator.onAuthenticateStart = { started.fulfill() }

        let firstTask = Task { await lock.requestApproval(reason: "First") }
        await fulfillment(of: [started], timeout: 5)
        XCTAssertFalse(lock.canBeginAuthentication)

        authenticator.resumeSuspendedAuthenticate()
        let firstOutcome = await firstTask.value
        XCTAssertEqual(firstOutcome, .authorized)
        XCTAssertTrue(lock.canBeginAuthentication)
    }

    /// A second approval request arriving while the first is still on-screen
    /// must come back `.busy` without ever prompting a second time and
    /// without disturbing the first, in-flight attempt.
    func testConcurrentApprovalRequestWhileAuthenticatingReturnsBusyWithoutSecondPrompt() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)

        let started = expectation(description: "first prompt started")
        authenticator.onAuthenticateStart = { started.fulfill() }

        let firstTask = Task { await lock.requestApproval(reason: "First") }
        await fulfillment(of: [started], timeout: 5)

        let busyOutcome = await lock.requestApproval(reason: "Second, concurrent")

        XCTAssertEqual(busyOutcome, .busy)
        XCTAssertEqual(authenticator.authenticateCallCount, 1, "the concurrent request must not open a second prompt")

        authenticator.resumeSuspendedAuthenticate()
        let firstOutcome = await firstTask.value
        XCTAssertEqual(firstOutcome, .authorized, "the first, genuinely in-flight request must still succeed")
    }

    /// A concurrent toggle flip while another toggle/approval authentication
    /// is in flight must be rejected without mutating the persisted
    /// preference or prompting again — this is what a Settings toggle's
    /// caller-side guard (via `canBeginAuthentication`) relies on to avoid
    /// showing a false "authentication failed" alert for a tap that was
    /// never actually attempted.
    func testConcurrentToggleWhileAuthenticatingDoesNotMutateSettingsOrPromptAgain() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let started = expectation(description: "first toggle authentication started")
        authenticator.onAuthenticateStart = { started.fulfill() }

        let firstTask = Task { await lock.setLockEnabled(true) }
        await fulfillment(of: [started], timeout: 5)
        XCTAssertFalse(lock.canBeginAuthentication)

        let concurrentOutcome = await lock.setLockEnabled(true)

        XCTAssertEqual(concurrentOutcome, .busy)
        XCTAssertFalse(lock.lockEnabled, "the concurrent, busy call must not mutate the preference")
        XCTAssertFalse(defaults.bool(forKey: AppLock.lockEnabledKey))
        XCTAssertEqual(authenticator.authenticateCallCount, 1, "the concurrent call must not open a second prompt")

        authenticator.resumeSuspendedAuthenticate()
        let firstOutcome = await firstTask.value
        XCTAssertEqual(firstOutcome, .authorized)
        XCTAssertTrue(lock.lockEnabled, "the first, genuinely in-flight toggle must still take effect")
    }

    func testBusyApprovedActionReturnsBusyWithoutExecutingAndFirstRequestMaySucceed() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        authenticator.authenticateResult = true
        let lock = makeLock(approvalEnabled: true, authenticator: authenticator)
        var executionCount = 0

        let started = expectation(description: "first approval started")
        authenticator.onAuthenticateStart = { started.fulfill() }
        let firstTask = Task { await lock.requestApproval(reason: "First") }
        await fulfillment(of: [started], timeout: 5)

        let busyOutcome = await lock.performApprovedAction(reason: "Second") {
            executionCount += 1
        }

        XCTAssertEqual(busyOutcome, .busy)
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(authenticator.authenticateCallCount, 1)

        authenticator.resumeSuspendedAuthenticate()
        let firstOutcome = await firstTask.value
        XCTAssertEqual(firstOutcome, .authorized)
    }

    func testBusyApprovedActionDoesNotBypassBusyGuardWhenApprovalsAreDisabled() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        let lock = makeLock(lockEnabled: false, approvalEnabled: false, authenticator: authenticator)
        var executionCount = 0

        let started = expectation(description: "setting authentication started")
        authenticator.onAuthenticateStart = { started.fulfill() }
        let settingTask = Task { await lock.setLockEnabled(true) }
        await fulfillment(of: [started], timeout: 5)

        let outcome = await lock.performApprovedAction(reason: "Change host") {
            executionCount += 1
        }

        XCTAssertEqual(outcome, .busy)
        XCTAssertEqual(executionCount, 0)

        authenticator.resumeSuspendedAuthenticate()
        _ = await settingTask.value
    }

    func testBusyNoOpSettingRequestReturnsBusyBecauseInFlightRequestMayChangeIt() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.suspendsAuthenticate = true
        let lock = makeLock(lockEnabled: false, authenticator: authenticator)

        let started = expectation(description: "enable authentication started")
        authenticator.onAuthenticateStart = { started.fulfill() }
        let enableTask = Task { await lock.setLockEnabled(true) }
        await fulfillment(of: [started], timeout: 5)

        let outcome = await lock.setLockEnabled(false)

        XCTAssertEqual(outcome, .busy)
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertFalse(defaults.bool(forKey: AppLock.lockEnabledKey))

        authenticator.resumeSuspendedAuthenticate()
        _ = await enableTask.value
    }

    func testNoOpSettingChangesAreAuthorizedWithoutAuthentication() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.canEvaluate = false
        let lock = makeLock(lockEnabled: false, approvalEnabled: true, authenticator: authenticator)

        let lockOutcome = await lock.setLockEnabled(false)
        let approvalOutcome = await lock.setApprovalEnabled(true)

        XCTAssertEqual(lockOutcome, .authorized)
        XCTAssertEqual(approvalOutcome, .authorized)
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
    }

    func testApprovalSettingReportsUnavailableWithoutMutation() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.canEvaluate = false
        let lock = makeLock(approvalEnabled: false, authenticator: authenticator)

        let outcome = await lock.setApprovalEnabled(true)

        XCTAssertEqual(outcome, .unavailable)
        XCTAssertFalse(lock.approvalEnabled)
        XCTAssertFalse(defaults.bool(forKey: AppLock.approvalEnabledKey))
        XCTAssertEqual(authenticator.authenticateCallCount, 0)
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

    func testUnavailableActiveRetainsElapsedTimerAndRestoredAvailabilityLocksAtTotalSixtySeconds() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.advance(by: 30)
        authenticator.canEvaluate = false
        authenticator.kind = .none
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isLocked, "unavailable authentication must never strand the user")
        XCTAssertFalse(lock.lockEnabled)

        clock.advance(by: 30)
        authenticator.canEvaluate = true
        authenticator.kind = .faceID
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.lockEnabled)
        XCTAssertTrue(lock.isLocked, "restored availability must apply the full retained elapsed interval")
    }

    func testRepeatedBackgroundEntryDoesNotReplaceRetainedEarlierInstant() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.advance(by: 30)
        authenticator.canEvaluate = false
        lock.sceneDidBecomeActive()

        lock.sceneDidEnterBackground()
        clock.advance(by: 30)
        authenticator.canEvaluate = true
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.isLocked, "the second background entry must not replace the earlier retained instant")
    }

    func testRestoredAvailabilityUnderTotalSixtySecondsPreservesGrace() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.advance(by: 20)
        authenticator.canEvaluate = false
        lock.sceneDidBecomeActive()
        clock.advance(by: 39)
        authenticator.canEvaluate = true
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.lockEnabled)
        XCTAssertFalse(lock.isLocked)

        clock.advance(by: 2)
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isLocked, "an available decision must consume the retained instant")
    }

    func testPersistedLockDisabledNeverAccumulatesBackgroundElapsedTime() {
        let clock = TestClock()
        let lock = makeLock(lockEnabled: false, clock: clock)

        lock.sceneDidEnterBackground()
        clock.advance(by: 120)
        defaults.set(true, forKey: AppLock.lockEnabledKey)
        lock.sceneDidBecomeActive()

        XCTAssertTrue(lock.lockEnabled)
        XCTAssertFalse(lock.isLocked, "time before the persisted preference was enabled must not count")
    }

    func testPersistedLockTurningOffClearsAnEarlierRetainedInstant() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()

        lock.sceneDidEnterBackground()
        clock.advance(by: 10)
        authenticator.canEvaluate = false
        lock.sceneDidBecomeActive()

        defaults.set(false, forKey: AppLock.lockEnabledKey)
        lock.sceneDidEnterBackground()
        clock.advance(by: 100)
        defaults.set(true, forKey: AppLock.lockEnabledKey)
        authenticator.canEvaluate = true
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isLocked, "elapsed time retained before the persisted preference turned off must be discarded")
    }

    func testSuccessfullyDisablingLockClearsRetainedBackgroundInstant() async {
        let clock = TestClock()
        let authenticator = FakeBiometricAuthenticator()
        let lock = makeLock(lockEnabled: true, authenticator: authenticator, clock: clock)
        _ = await lock.unlock()
        lock.sceneDidEnterBackground()
        clock.advance(by: 10)
        authenticator.canEvaluate = false
        lock.sceneDidBecomeActive()

        authenticator.canEvaluate = true
        let disableOutcome = await lock.setLockEnabled(false)
        XCTAssertEqual(disableOutcome, .authorized)

        defaults.set(true, forKey: AppLock.lockEnabledKey)
        clock.advance(by: 100)
        lock.sceneDidBecomeActive()

        XCTAssertFalse(lock.isLocked, "a retained instant must not survive a successful disable")
    }

    /// Once availability returns, effective lock must restore while the
    /// logical approval preference remains enabled throughout.
    func testRestoredAvailabilityRestoresEffectiveLockAndPreservesLogicalApproval() async {
        let authenticator = FakeBiometricAuthenticator()
        authenticator.authenticateResult = true
        let lock = makeLock(lockEnabled: true, approvalEnabled: true, authenticator: authenticator)
        _ = await lock.unlock()

        authenticator.canEvaluate = false
        authenticator.kind = .none
        lock.sceneDidBecomeActive()
        XCTAssertFalse(lock.lockEnabled)
        XCTAssertTrue(lock.approvalEnabled, "approvalEnabled is the persisted logical preference")

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
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: false, alreadyLocked: false, backgroundDuration: .seconds(600)))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: nil))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: .seconds(59)))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: .seconds(60)))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: true, backgroundDuration: .seconds(1)))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: .seconds(-1)))
    }
}
