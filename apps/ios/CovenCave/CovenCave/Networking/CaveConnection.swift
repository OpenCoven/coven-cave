import Foundation

/// Describes the Tailscale host and optional mobile access credential. The
/// desktop may publish the full API through `tailscale serve`, so tailnet
/// reachability is paired with a Cave access token for authorization.
struct CaveConnection: Codable, Equatable {
    /// A MagicDNS name (e.g. `my-mac.tailnet-name.ts.net`) or a raw Tailscale IP
    /// (e.g. `100.101.102.103`). May include a scheme and/or port; we normalise.
    var host: String

    /// Resolved base URL for the API. MagicDNS `.ts.net` hosts use HTTPS (valid
    /// Tailscale-issued certs); bare IPs / hostnames fall back to HTTP on :3000.
    var baseURL: URL? {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Already a full URL? MagicDNS hosts always use HTTPS. A pasted
        // `http://*.ts.net` URL would otherwise be rejected by ATS (and derive
        // an insecure `ws://` terminal URL), despite Tailscale Serve issuing a
        // certificate for the host.
        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            if var components = URLComponents(string: trimmed),
               components.scheme?.lowercased() == "http",
               components.host?.lowercased().hasSuffix(".ts.net") == true {
                components.scheme = "https"
                return components.url
            }
            return URL(string: trimmed)
        }

        // MagicDNS .ts.net → HTTPS, with or without an explicit port
        // (`tailscale serve` often terminates TLS on :8443, so a relocated
        // "host.ts.net:8443" must still derive https, not http).
        let hostPart = trimmed.split(separator: ":").first.map(String.init) ?? trimmed
        if hostPart.lowercased().hasSuffix(".ts.net") || trimmed.lowercased().contains(".ts.net/") {
            return URL(string: "https://\(trimmed)")
        }

        // Bare host or IP → HTTP on the dev server port unless a port is present.
        if trimmed.contains(":") {
            return URL(string: "http://\(trimmed)")
        }
        return URL(string: "http://\(trimmed):3000")
    }

    /// WebSocket base derived from `baseURL` (https→wss, http→ws). Used by the
    /// Developer terminal surface to reach `/api/pty-ws`.
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
    /// (the user was explicit), so it gets no alternates. Explicit HTTP
    /// MagicDNS URLs are normalized to HTTPS before the single candidate is returned.
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
            if let url = baseURL { out.append(url) }
            return out
        }

        if let primary = baseURL { out.append(primary) }

        let hostname = trimmed.split(separator: ":").first.map(String.init) ?? trimmed
        if hostname.lowercased().hasSuffix(".ts.net") {
            add("https://\(hostname):8443")   // Tailscale Serve's usual TLS port
            add("https://\(hostname)")        // bare 443
        } else {
            // The desktop falls back through 3000-3010 when ports are taken
            // (scripts/dev-app.sh / server.ts PORT), so probe the whole range.
            //
            // These extra candidates are NOT free: the paired path probes
            // sequentially on purpose (see AppModel.discoverBaseURL — fanning
            // the Bearer token across ports concurrently would widen credential
            // exposure), so 16 candidates x a 6s timeout is a 96s worst case
            // when packets are silently dropped. `lastGoodBaseURL` is what keeps
            // the common case at a single probe; do not add candidates on the
            // assumption that they cost nothing (cave-ioswipe.3).
            for port in 3000...3010 { add("http://\(hostname):\(port)") }
            for port in ["4500", "4555", "8443"] { add("http://\(hostname):\(port)") }
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
        UserDefaults.standard.removeObject(forKey: lastGoodKey)
        KeychainStore.remove(tokenKey)
    }

    /// The base URL that last answered a successful probe, per host
    /// (cave-ioswipe.3). Discovery tries this first, which turns the common
    /// reconnect — same desktop, same port — into ONE probe instead of walking
    /// the candidate list. Keyed by host so a remembered port for one desktop
    /// is never tried against a different one.
    ///
    /// Not a secret (the host string beside it is already plain UserDefaults),
    /// so it does not belong in the Keychain.
    static let lastGoodKey = "cave.connection.last-good"

    private static func lastGoodMap() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: lastGoodKey) as? [String: String] ?? [:]
    }

    static func lastGoodBaseURL(forHost host: String) -> URL? {
        let key = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty, let raw = lastGoodMap()[key] else { return nil }
        return URL(string: raw)
    }

    static func saveLastGoodBaseURL(_ url: URL, forHost host: String) {
        let key = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return }
        var map = lastGoodMap()
        map[key] = url.absoluteString
        UserDefaults.standard.set(map, forKey: lastGoodKey)
    }

    /// Candidates with the last-good URL hoisted to the front. Kept separate
    /// from `candidateBaseURLs` so that property stays pure and testable; only
    /// this one reads persisted state.
    var prioritizedCandidateBaseURLs: [URL] {
        let candidates = candidateBaseURLs
        guard let remembered = Self.lastGoodBaseURL(forHost: host),
              candidates.contains(remembered),
              candidates.first != remembered
        else { return candidates }
        return [remembered] + candidates.filter { $0 != remembered }
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
    case serverResponse(status: Int, code: String?, message: String?)
    case decoding(String)
    case transport(String)

    static func isAuthFailure(_ error: Error) -> Bool {
        switch error {
        case CaveError.badResponse(let status):
            return status == 401 || status == 403
        case CaveError.serverResponse(let status, let code, _):
            if status == 401 { return true }
            if status == 403 {
                // A scoped project denial means the pairing is valid; sending
                // the user back through pairing would hide the actionable fix.
                return code != "project_access_denied"
            }
            return false
        default:
            return false
        }
    }

    var requiresProjectSelection: Bool {
        guard case .serverResponse(_, let code, _) = self else { return false }
        return [
            "project_root_required",
            "project_root_unavailable",
            "project_root_not_directory",
            "project_root_invalid",
            "project_not_registered",
            "project_access_denied",
        ].contains(code)
    }

    var isDefinitiveServerResponse: Bool {
        if case .serverResponse(let status, _, _) = self {
            return (400..<500).contains(status)
        }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "No host configured."
        case .badResponse(let code): return "Server returned status \(code)."
        case .serverResponse(let status, _, let message):
            let trimmed = message?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed?.isEmpty == false ? trimmed : "Server returned status \(status)."
        case .decoding(let msg): return "Could not read the response: \(msg)"
        case .transport(let msg): return msg
        }
    }
}
