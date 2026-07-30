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
    var current: Date
    init(_ date: Date = Date(timeIntervalSinceReferenceDate: 0)) { current = date }
    func now() -> Date { current }
    func advance(by seconds: TimeInterval) { current = current.addingTimeInterval(seconds) }
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
        return AppLock(authenticator: authenticator, defaults: defaults, now: clock.now)
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

    // MARK: - Pure policy

    func testAppLockPolicyGraceBoundary() {
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: false, alreadyLocked: false, backgroundDuration: 600))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: nil))
        XCTAssertFalse(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: 59))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: false, backgroundDuration: 60))
        XCTAssertTrue(AppLockPolicy.shouldLock(enabled: true, alreadyLocked: true, backgroundDuration: 1))
    }
}
