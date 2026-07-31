import LocalAuthentication
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

/// Tests for the pure runtime classification rule: hardware `biometryType`
/// alone must never be trusted for the label — it stays populated even when
/// no biometrics are enrolled/available, so `.deviceOwnerAuthenticationWithBiometrics`
/// evaluability must gate whether the biometric-specific kind is reported.
/// These exercise `BiometricPolicyClassifier.kind(...)` directly (no real
/// `LAContext`) so the reviewer-flagged scenario — Face/Touch/Optic hardware
/// present but nothing enrolled, device-owner auth still possible via
/// passcode — is genuinely covered without needing physical hardware state.
final class BiometricPolicyClassifierTests: XCTestCase {
    func testEnrolledFaceIDReportsFaceIDKind() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .faceID, canEvaluateBiometrics: true)
        XCTAssertEqual(kind, .faceID)
    }

    func testEnrolledTouchIDReportsTouchIDKind() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .touchID, canEvaluateBiometrics: true)
        XCTAssertEqual(kind, .touchID)
    }

    func testEnrolledOpticIDReportsOpticIDKind() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .opticID, canEvaluateBiometrics: true)
        XCTAssertEqual(kind, .opticID)
    }

    func testFaceIDHardwareWithoutEnrollmentReportsPasscode() {
        // Face ID hardware present (biometryType == .faceID) but nothing
        // enrolled/available: must report passcode, not Face ID.
        let kind = BiometricPolicyClassifier.kind(biometryType: .faceID, canEvaluateBiometrics: false)
        XCTAssertEqual(kind, .none)
    }

    func testTouchIDHardwareWithoutEnrollmentReportsPasscode() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .touchID, canEvaluateBiometrics: false)
        XCTAssertEqual(kind, .none)
    }

    func testOpticIDHardwareWithoutEnrollmentReportsPasscode() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .opticID, canEvaluateBiometrics: false)
        XCTAssertEqual(kind, .none)
    }

    func testNoBiometricHardwareReportsPasscode() {
        let kind = BiometricPolicyClassifier.kind(biometryType: .none, canEvaluateBiometrics: false)
        XCTAssertEqual(kind, .none)
    }
}
