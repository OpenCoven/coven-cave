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
        return (canEvaluate, biometricKind(for: context))
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

    private func biometricKind(for context: LAContext) -> BiometricKind {
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .none
        }
    }
}
