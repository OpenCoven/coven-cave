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

    /// Ordered base URLs to try when the configured one is unreachable — the fix
    /// for a host entered without the proper port. `tailscale serve` usually
    /// terminates TLS on `:8443`, so a `.ts.net` host typed without a port
    /// (which resolves to plain `:443`) never connects; we probe `:8443` and
    /// relocate to it. A fully-qualified `http(s)://…` URL is trusted verbatim
    /// (the user was explicit), so it gets no alternates.
    var candidateBaseURLs: [URL] {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        var out: [URL] = []
        func add(_ string: String) {
            guard let url = URL(string: string), !out.contains(url) else { return }
            out.append(url)
        }

        let lower = trimmed.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            if let url = URL(string: trimmed) { out.append(url) }
            return out
        }

        if let primary = baseURL { out.append(primary) }

        let hostname = trimmed.split(separator: ":").first.map(String.init) ?? trimmed
        if hostname.lowercased().hasSuffix(".ts.net") {
            add("https://\(hostname):8443")   // Tailscale Serve's usual TLS port
            add("https://\(hostname)")        // bare 443
        } else {
            for port in ["3000", "4500", "4555", "8443"] { add("http://\(hostname):\(port)") }
            add("https://\(hostname):8443")
        }
        return out
    }

    static let storageKey = "cave.connection.host"
    static let tokenKey = "cave.access-token"

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
        KeychainStore.remove(tokenKey)
    }

    /// The mobile access credential, when this desktop's API is token-gated
    /// (COVEN_CAVE_ACCESS_TOKEN on the server). Kept in the Keychain — the
    /// host string above is not a secret, this is.
    static var accessToken: String? {
        KeychainStore.string(forKey: tokenKey)
    }

    static func saveAccessToken(_ token: String?) {
        if let token, !token.isEmpty {
            KeychainStore.set(token, forKey: tokenKey)
        } else {
            KeychainStore.remove(tokenKey)
        }
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
