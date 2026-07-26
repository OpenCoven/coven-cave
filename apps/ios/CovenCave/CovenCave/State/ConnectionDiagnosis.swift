import Foundation

/// Why a discovery probe failed, ranked by diagnostic strength. Higher raw
/// values are MORE specific signals: "an HTTP server answered but it wasn't
/// Cave" pins the problem to one address, while "timed out" could be anything.
/// When candidates fail for different reasons, `max()` picks the story the
/// user should hear (`.offline` outranks everything — it explains everything).
enum ProbeFailure: Int, Equatable, Comparable, Sendable {
    /// Transport failed in some unclassified way.
    case transport = 0
    /// No response inside the probe window — host asleep, tailnet stalled.
    case timeout = 1
    /// The name never resolved — MagicDNS only answers while Tailscale is up.
    case dnsFailure = 2
    /// TLS negotiation failed — usually a scheme/port mismatch.
    case tlsFailure = 3
    /// Route reached the machine but the port refused — Cave isn't listening.
    case refused = 4
    /// An HTTP server answered, but the body wasn't the Cave API.
    case wrongServer = 5
    /// This phone has no network at all.
    case offline = 6

    static func < (lhs: ProbeFailure, rhs: ProbeFailure) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// One-line phrasing for the connect screen's live as-you-type preview —
    /// terse next to the full recovery callout copy in ConnectionDiagnosis.
    var previewLine: String {
        switch self {
        case .offline: return "This phone is offline."
        case .dnsFailure: return "Name didn’t resolve — is Tailscale connected?"
        case .refused: return "Reached the machine, but Cave isn’t answering there."
        case .timeout: return "No answer yet — desktop asleep or off the tailnet?"
        case .tlsFailure: return "Secure handshake failed at that address."
        case .wrongServer: return "Something answered, but it isn’t Cave."
        case .transport: return "Couldn’t reach that address yet."
        }
    }

    /// Map a thrown transport error onto a failure class. Pure so the
    /// adjudication story is unit-testable without spinning up URLSession.
    init(classifying error: any Error) {
        guard let urlError = error as? URLError else {
            self = .transport
            return
        }
        switch urlError.code {
        case .notConnectedToInternet, .internationalRoamingOff, .dataNotAllowed:
            self = .offline
        case .cannotFindHost, .dnsLookupFailed:
            self = .dnsFailure
        case .timedOut:
            self = .timeout
        case .cannotConnectToHost, .networkConnectionLost:
            self = .refused
        case .secureConnectionFailed, .serverCertificateUntrusted,
             .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid, .clientCertificateRejected,
             .clientCertificateRequired, .appTransportSecurityRequiresSecureConnection:
            self = .tlsFailure
        default:
            self = .transport
        }
    }
}

/// What the connect screen should say when discovery fails: a titled recovery
/// callout derived from the strongest probe signal instead of one generic
/// "couldn't reach the desktop" shrug for every distinct failure.
struct ConnectionDiagnosis: Equatable, Sendable {
    var title: String
    var message: String
    var guidance: String
    var systemImage: String

    /// The pre-diagnosis copy, kept verbatim for the unclassified case.
    static let generic = ConnectionDiagnosis(
        title: "Tailscale disconnected?",
        message: "Couldn’t reach the desktop. Is it on the tailnet and running?",
        guidance: "Open Tailscale on this phone and make sure it says Connected. If it is connected, check that Cave is running on the desktop.",
        systemImage: "exclamationmark.triangle.fill"
    )

    static func diagnosis(for failure: ProbeFailure?) -> ConnectionDiagnosis {
        guard let failure else { return .generic }
        switch failure {
        case .offline:
            return ConnectionDiagnosis(
                title: "This phone is offline",
                message: "No network connection on this phone — Wi‑Fi and cellular are both unavailable.",
                guidance: "Turn off Airplane Mode or join a network, then try again.",
                systemImage: "wifi.slash"
            )
        case .dnsFailure:
            return ConnectionDiagnosis(
                title: "Name didn’t resolve",
                message: "The desktop’s name couldn’t be found. MagicDNS names only resolve while Tailscale is connected on this phone.",
                guidance: "Open Tailscale on this phone and make sure it says Connected, then try again.",
                systemImage: "questionmark.circle.fill"
            )
        case .refused:
            return ConnectionDiagnosis(
                title: "Cave isn’t answering",
                message: "Reached the desktop, but nothing is listening on that port. Cave may not be running.",
                guidance: "Start Cave on the desktop, or check “Open on phone” for the current address.",
                systemImage: "bolt.horizontal.circle"
            )
        case .timeout:
            return ConnectionDiagnosis(
                title: "No answer from the desktop",
                message: "The address didn’t respond in time — the desktop may be asleep, offline, or off the tailnet.",
                guidance: "Wake the desktop and check Tailscale says Connected on both devices.",
                systemImage: "clock.badge.exclamationmark"
            )
        case .tlsFailure:
            return ConnectionDiagnosis(
                title: "Secure connection failed",
                message: "The desktop answered, but the secure handshake failed — usually a scheme or port mismatch.",
                guidance: "Re-scan the QR from “Open on phone” to pick up the desktop’s current address.",
                systemImage: "lock.trianglebadge.exclamationmark"
            )
        case .wrongServer:
            return ConnectionDiagnosis(
                title: "That isn’t Cave",
                message: "Something answered at that address, but it isn’t the Cave desktop app.",
                guidance: "Double-check the address in Cave under “Open on phone” — the port matters.",
                systemImage: "server.rack"
            )
        case .transport:
            return ConnectionDiagnosis(
                title: "Connection failed",
                message: "The connection to the desktop failed before it could complete.",
                guidance: "Check Tailscale on this phone, then try again.",
                systemImage: "exclamationmark.triangle.fill"
            )
        }
    }
}
