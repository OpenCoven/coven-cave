import XCTest

/// TEMPORARY — REMOVED IN THE NEXT COMMIT ON THIS BRANCH.
///
/// cave-ac372's acceptance criterion is that the fix be proven by a
/// deliberately failing XCTest that CI catches. A green run over passing tests
/// cannot distinguish "executed and passed" from "never executed" — which is
/// precisely the state that produced the bead, and precisely the mistake a
/// cosmetic version of this fix would repeat.
///
/// So this file exists for exactly one CI run: the `iOS build` job must go RED
/// naming `testTheGateActuallyFails`, and the verification step must report
/// `failed 1` alongside a non-zero executed count. Once that is on record, the
/// file is deleted and the job must return to green with the same count minus
/// one.
///
/// If you are reading this on `main`, the removal commit was lost — delete it.
final class CIGateCanaryTests: XCTestCase {
    func testTheGateActuallyFails() {
        XCTFail("cave-ac372 canary: this failure must turn the iOS build job red. Remove this file.")
    }
}
