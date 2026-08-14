import Foundation

/// Pure, UI-independent presentation logic for a live voice call. The view and
/// view-model read these mappings so the SwiftUI layer stays a thin renderer
/// and the phase→copy / error→recovery decisions can be unit-tested without a
/// simulator, network, or audio session.

/// How the call surface should describe a non-terminal phase.
struct VoiceCallStatusCopy: Equatable {
    let label: String
    /// Secondary line; nil when the label alone is enough.
    let detail: String?
}

/// A terminal error rendered as actionable copy plus the one recovery the
/// reducer and platform actually allow from here.
struct VoiceCallErrorCopy: Equatable {
    enum Recovery: Equatable {
        /// Rebuild the coordinator and try the same transport again.
        case retry
        /// The failure is a denied system permission; only Settings fixes it.
        case openSettings
        /// Nothing the operator can do in-app; only dismiss.
        case dismiss
    }

    let title: String
    let message: String
    let recovery: Recovery
    /// Whether to additionally offer the on-device call as a graceful fallback.
    /// Only meaningful while the failed call was a Realtime call.
    let offersOnDeviceFallback: Bool
}

/// Chooses the transport for a call and the fallback when Realtime cannot be
/// reached. Kept separate from `VoiceCallMode.forVoiceProvider` so the fallback
/// rule has one testable home.
enum VoiceTransportPlanner {
    /// The transport a familiar's published voice metadata asks for.
    static func plan(for familiar: Familiar) -> VoiceCallMode {
        VoiceCallMode.forVoiceProvider(familiar.voiceProvider)
    }

    /// The graceful fallback when the planned transport cannot start. Realtime
    /// degrades to the on-device call; the on-device call has nothing further
    /// to fall back to.
    static func fallback(after mode: VoiceCallMode) -> VoiceCallMode? {
        switch mode {
        case .realtime: .native
        case .native: nil
        }
    }
}

enum VoiceCallCopy {
    static func modeLabel(_ mode: VoiceCallMode) -> String {
        switch mode {
        case .realtime: "Live voice"
        case .native: "On-device voice"
        }
    }

    /// Non-terminal phase → status copy. Terminal phases (`.error`, `.ended`)
    /// are handled by `error(for:mode:)` and the ended state respectively.
    static func status(for phase: VoiceCallPhase, mode: VoiceCallMode) -> VoiceCallStatusCopy {
        switch phase {
        case .idle:
            return VoiceCallStatusCopy(label: "Ready", detail: nil)
        case .requestingPermission:
            return VoiceCallStatusCopy(
                label: "Waiting for microphone",
                detail: "Allow access to start talking."
            )
        case .connecting:
            return VoiceCallStatusCopy(
                label: mode == .realtime ? "Connecting" : "Starting",
                detail: mode == .realtime ? "Opening the live voice channel…" : nil
            )
        case .listening:
            return VoiceCallStatusCopy(label: "Listening", detail: nil)
        case .processing:
            return VoiceCallStatusCopy(label: "Thinking", detail: nil)
        case .speaking:
            return VoiceCallStatusCopy(label: "Speaking", detail: nil)
        case .ended:
            return VoiceCallStatusCopy(label: "Call ended", detail: nil)
        case .error:
            // Callers render errors through `error(for:mode:)`; this keeps the
            // switch exhaustive without duplicating that mapping.
            return VoiceCallStatusCopy(label: "Call ended", detail: nil)
        }
    }

    /// Copy shown while the desktop is minting a Realtime grant, before the
    /// coordinator's own phases take over.
    static var mintingStatus: VoiceCallStatusCopy {
        VoiceCallStatusCopy(label: "Connecting", detail: "Reaching the live voice provider…")
    }

    /// The offer shown when a Realtime grant could not be minted (no API key,
    /// offline, or the desktop refused). This is a real, actionable fallback —
    /// the operator can still talk to the familiar entirely on-device.
    static func mintFailureFallback(_ underlying: String?) -> VoiceCallErrorCopy {
        let detail = cleaned(underlying)
        let message = detail.map { "The desktop couldn't start a live voice call: \($0)" }
            ?? "The desktop couldn't start a live voice call. This usually means no voice API key is configured or the desktop is offline."
        return VoiceCallErrorCopy(
            title: "Live voice unavailable",
            message: message,
            recovery: .retry,
            offersOnDeviceFallback: true
        )
    }

    /// Terminal error code (from the reducer / transports) → operator-facing
    /// copy and the single recovery that can actually help from here.
    static func error(for code: String, mode: VoiceCallMode) -> VoiceCallErrorCopy {
        let realtime = mode == .realtime

        switch code {
        case "microphone_denied":
            return VoiceCallErrorCopy(
                title: "Microphone access is off",
                message: "Coven Cave needs the microphone for a voice call. Turn it on in Settings, then start the call again.",
                recovery: .openSettings,
                offersOnDeviceFallback: false
            )
        case "speech_recognition_denied":
            return VoiceCallErrorCopy(
                title: "Speech recognition is off",
                message: "An on-device call transcribes your speech on this iPhone. Allow Speech Recognition in Settings to continue.",
                recovery: .openSettings,
                offersOnDeviceFallback: false
            )
        case "speech_recognizer_unavailable":
            return VoiceCallErrorCopy(
                title: "Speech recognition unavailable",
                message: "This iPhone can't transcribe speech right now. Check that a language is downloaded for dictation and try again.",
                recovery: .retry,
                offersOnDeviceFallback: false
            )
        case "speech_audio_engine_failed", "speech_recognition_failed":
            return VoiceCallErrorCopy(
                title: "Couldn't hear you",
                message: "The microphone stopped unexpectedly. Try the call again.",
                recovery: .retry,
                offersOnDeviceFallback: false
            )
        case "voice_turn_send_failed":
            return VoiceCallErrorCopy(
                title: "Reply didn't come through",
                message: "The familiar couldn't be reached for that turn. Check your connection to the desktop and try again.",
                recovery: .retry,
                offersOnDeviceFallback: false
            )
        case "audio_interrupted":
            return VoiceCallErrorCopy(
                title: "Call interrupted",
                message: "Another app or an incoming call took over audio. Start the call again when you're ready.",
                recovery: .retry,
                offersOnDeviceFallback: realtime
            )
        case "audio_route_changed":
            return VoiceCallErrorCopy(
                title: "Audio device changed",
                message: "Your headphones or speaker changed mid-call. Start the call again to reconnect audio.",
                recovery: .retry,
                offersOnDeviceFallback: realtime
            )
        default:
            if code.hasPrefix("realtime_") {
                return realtimeError(code)
            }
            return VoiceCallErrorCopy(
                title: "Call ended",
                message: "Something went wrong with the call. Try again.",
                recovery: .retry,
                offersOnDeviceFallback: realtime
            )
        }
    }

    private static func realtimeError(_ code: String) -> VoiceCallErrorCopy {
        let message: String
        switch code {
        case "realtime_grant_missing", "realtime_connection_url_invalid":
            message = "The desktop's voice grant was incomplete. Retry, or switch to an on-device call."
        case "realtime_empty_sdp_answer":
            message = "The voice provider didn't answer. Retry, or switch to an on-device call."
        case "realtime_event_decode_failed":
            message = "The live voice stream sent something unexpected. Retry, or switch to an on-device call."
        default:
            if code.hasPrefix("realtime_signaling_failed_") {
                message = "The voice provider refused the connection. Retry, or switch to an on-device call."
            } else if code.hasPrefix("realtime_ice_") {
                message = "The live voice connection dropped. Retry, or switch to an on-device call."
            } else {
                message = "The live voice call failed. Retry, or switch to an on-device call."
            }
        }
        return VoiceCallErrorCopy(
            title: "Live voice call failed",
            message: message,
            recovery: .retry,
            offersOnDeviceFallback: true
        )
    }

    private static func cleaned(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
