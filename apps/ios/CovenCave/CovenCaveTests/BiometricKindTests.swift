import XCTest
@testable import CovenCave

/// Pure tests for `BiometricKind`'s user-visible copy. No `LAContext`
/// involved — these assert the label/systemImage mapping directly so the
/// lock screen and Settings iconography stays correct without driving real
/// biometrics.
final class BiometricKindTests: XCTestCase {
    func testFaceIDLabelAndSystemImage() {
        XCTAssertEqual(BiometricKind.faceID.label, "Face ID")
        XCTAssertEqual(BiometricKind.faceID.systemImage, "faceid")
    }

    func testTouchIDLabelAndSystemImage() {
        XCTAssertEqual(BiometricKind.touchID.label, "Touch ID")
        XCTAssertEqual(BiometricKind.touchID.systemImage, "touchid")
    }

    func testOpticIDLabelAndSystemImage() {
        XCTAssertEqual(BiometricKind.opticID.label, "Optic ID")
        XCTAssertEqual(BiometricKind.opticID.systemImage, "opticid")
    }

    func testNoneLabelAndSystemImageFallBackToPasscode() {
        XCTAssertEqual(BiometricKind.none.label, "Device Passcode")
        XCTAssertEqual(BiometricKind.none.systemImage, "lock.shield")
    }
}
