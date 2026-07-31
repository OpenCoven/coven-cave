import Foundation
import LocalAuthentication

/// Which biometric method (if any) `.deviceOwnerAuthentication` will present
/// on this device. `.none` still means device-owner authentication can
/// succeed via the passcode fallback alone (no enrolled biometry, or none
/// available) — see `BiometricAuthenticating.availability()`.
enum BiometricKind: Equatable {
    case none
    case touchID
    case faceID
    case opticID

    /// Accurate, user-facing label for Settings rows and lock-screen copy.
    var label: String {
        switch self {
        case .none: return "Device Passcode"
        case .touchID: return "Touch ID"
        case .faceID: return "Face ID"
        case .opticID: return "Optic ID"
        }
    }

    /// SF Symbol matching the label, for lock screen + Settings iconography.
    var systemImage: String {
        switch self {
        case .none: return "lock.shield"
        case .touchID: return "touchid"
        case .faceID: return "faceid"
        case .opticID: return "opticid"
        }
    }
}

/// Pure classification rule turning hardware/policy facts into a
/// `BiometricKind`. Extracted from `LAContextBiometricAuthenticator` so it's
/// testable without a real `LAContext`: `LAContext.biometryType` reflects the
/// *hardware* present and stays populated even when nothing is
/// enrolled/available, so it must never be trusted on its own. Only when
/// `.deviceOwnerAuthenticationWithBiometrics` can currently evaluate (i.e.
/// biometrics are enrolled and available) does the hardware type become a
/// trustworthy label; otherwise device-owner auth can still succeed via the
/// passcode fallback alone, and callers must report that instead of an
/// incorrect biometric label.
enum BiometricPolicyClassifier {
    static func kind(biometryType: LABiometryType, canEvaluateBiometrics: Bool) -> BiometricKind {
        guard canEvaluateBiometrics else { return .none }
        switch biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .none
        }
    }
}

/// Abstraction over LocalAuthentication so `AppLock` can be exercised with a
/// fake in unit tests instead of driving real Face ID/Touch ID prompts.
protocol BiometricAuthenticating {
    /// Whether `.deviceOwnerAuthentication` (biometric + device-passcode
    /// fallback) is currently possible, and which biometric kind would be
    /// attempted first.
    func availability() -> (canEvaluate: Bool, kind: BiometricKind)

    /// Prompts a fresh device-owner authentication (Face ID/Touch ID/Optic ID
    /// with passcode fallback) with the given reason. Returns whether it
    /// succeeded.
    func authenticate(reason: String) async -> Bool
}

/// Live `LocalAuthentication`-backed adapter. A new `LAContext` is created
/// per call — LAContext can otherwise silently reuse a very recent successful
/// evaluation instead of prompting again, which would undermine both the
/// "fresh authentication" requirement for approvals and testability.
struct LAContextBiometricAuthenticator: BiometricAuthenticating {
    func availability() -> (canEvaluate: Bool, kind: BiometricKind) {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)

        // `.deviceOwnerAuthentication` alone succeeding (or failing) says
        // nothing about biometrics specifically — device-owner auth can
        // still succeed via the passcode fallback with biometric hardware
        // present but nothing enrolled. Check the biometrics-only policy
        // separately so the label doesn't lie about that.
        var biometricsError: NSError?
        let canEvaluateBiometrics = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &biometricsError
        )
        let kind = BiometricPolicyClassifier.kind(
            biometryType: context.biometryType,
            canEvaluateBiometrics: canEvaluateBiometrics
        )
        return (canEvaluate, kind)
    }

    func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }
}
