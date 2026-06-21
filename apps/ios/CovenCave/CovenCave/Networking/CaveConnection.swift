import Foundation

/// Describes how to reach the desktop host over Tailscale.
///
/// There is **no token**. Trust is established by being on the same Tailscale
/// tailnet as the host: the desktop serves the mobile API only over its Tailscale
/// interface (via `tailscale serve`), so any request that reaches it is already
/// tailnet-authenticated. The app only needs the host's address.
struct CaveConnection: Codable, Equatable {
    /// A MagicDNS name (e.g. `my-mac.tailnet-name.ts.net`) or a raw Tailscale IP
    /// (e.g. `100.101.102.103`). May include a scheme and/or port; we normalise.
    var host: String

    /// Resolved base URL for the API. MagicDNS `.ts.net` hosts use HTTPS (valid
    /// Tailscale-issued certs); bare IPs / hostnames fall back to HTTP on :3000.
    var baseURL: URL? {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Already a full URL? Use it.
        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            return URL(string: trimmed)
        }

        // MagicDNS .ts.net → HTTPS, default port (Tailscale Serve terminates TLS).
        if trimmed.lowercased().hasSuffix(".ts.net") || trimmed.lowercased().contains(".ts.net/") {
            return URL(string: "https://\(trimmed)")
        }

        // Bare host or IP → HTTP on the dev server port unless a port is present.
        if trimmed.contains(":") {
            return URL(string: "http://\(trimmed)")
        }
        return URL(string: "http://\(trimmed):3000")
    }

    /// WebSocket base derived from `baseURL` (https→wss, http→ws). Used by the
    /// Developer tab's terminal to reach `/api/pty-ws`.
    var wsBaseURL: URL? {
        guard let base = baseURL,
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        return comps.url
    }

    static let storageKey = "cave.connection.host"

    static func load() -> CaveConnection? {
        guard let host = UserDefaults.standard.string(forKey: storageKey),
              !host.isEmpty else { return nil }
        return CaveConnection(host: host)
    }

    func save() {
        UserDefaults.standard.set(host, forKey: Self.storageKey)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}

enum CaveError: LocalizedError {
    case notConfigured
    case badResponse(Int)
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "No host configured."
        case .badResponse(let code): return "Server returned status \(code)."
        case .decoding(let msg): return "Could not read the response: \(msg)"
        case .transport(let msg): return msg
        }
    }
}
