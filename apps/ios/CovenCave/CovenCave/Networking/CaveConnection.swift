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

        // Bare host or IP → HTTP on Cave's dedicated PRODUCTION port unless a
        // port is present. A phone pairs with the packaged desktop app, which
        // now always binds that port (src-tauri/src/sidecar_ports.rs); it used
        // to take a random one per launch, so this default was only ever right
        // for someone running `pnpm dev` on their Mac. The dev port stays in the
        // alternates below so that case still connects.
        if trimmed.contains(":") {
            return URL(string: "http://\(trimmed)")
        }
        return URL(string: "http://\(trimmed):\(CavePorts.production)")
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
            // The dedicated ports come first: production is what a packaged
            // desktop binds, dev is what `pnpm dev` binds. The 3000-3010 sweep
            // stays behind them because the macOS background-availability
            // daemon can still fall back into that range when the dedicated
            // port is occupied (src-tauri/src/desktop_reachability.rs).
            //
            // These extra candidates are NOT free: the paired path probes
            // sequentially on purpose (see AppModel.discoverBaseURL — fanning
            // the Bearer token across ports concurrently would widen credential
            // exposure), so 16 candidates x a 6s timeout is a 96s worst case
            // when packets are silently dropped. `lastGoodBaseURL` is what keeps
            // the common case at a single probe; do not add candidates on the
            // assumption that they cost nothing (cave-ioswipe.3).
            add("http://\(hostname):\(CavePorts.production)")
            add("http://\(hostname):\(CavePorts.dev)")
            for port in 3000...3010 { add("http://\(hostname):\(port)") }
            for port in ["4500", "4555", "8443"] { add("http://\(hostname):\(port)") }
            add("https://\(hostname):8443")
        }
        return out
    }

    static let storageKey = "cave.connection.host"
    static let tokenKey = "cave.access-token"
    static let tokenOriginKey = "cave.access-token-origin"

    static func load() -> CaveConnection? {
        guard let host = UserDefaults.standard.string(forKey: storageKey),
              !host.isEmpty else { return nil }
        let connection = CaveConnection(host: host)
        if accessToken != nil, accessTokenOrigin == nil,
           let baseURL = connection.baseURL,
           let origin = credentialOrigin(for: baseURL) {
            KeychainStore.set(origin, forKey: tokenOriginKey)
        }
        return connection
    }

    func save() {
        UserDefaults.standard.set(host, forKey: Self.storageKey)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
        UserDefaults.standard.removeObject(forKey: lastGoodKey)
        KeychainStore.remove(tokenKey)
        KeychainStore.remove(tokenOriginKey)
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

    static var accessTokenOrigin: String? {
        KeychainStore.string(forKey: tokenOriginKey)
    }

    static func credentialOrigin(for url: URL) -> String? {
        guard let rawScheme = url.scheme?.lowercased(),
              let rawHost = url.host?.lowercased()
        else { return nil }
        let scheme: String
        switch rawScheme {
        case "https", "wss": scheme = "https"
        case "http", "ws": scheme = "http"
        default: return nil
        }
        let host = rawHost.contains(":") ? "[\(rawHost)]" : rawHost
        let defaultPort = scheme == "https" ? 443 : 80
        let port = url.port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    static func isCredentialTransportSecure(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        if scheme == "https" || scheme == "wss" { return true }
        guard scheme == "http" || scheme == "ws" else { return false }
        let host = url.host?.lowercased()
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    static func credentialOriginMatches(_ storedOrigin: String?, requestURL: URL) -> Bool {
        guard let storedOrigin else { return false }
        return credentialOrigin(for: requestURL) == storedOrigin
    }

    static func credentialForRequest(to url: URL) throws -> String? {
        guard let token = accessToken else { return nil }
        guard isCredentialTransportSecure(url) else {
            throw CaveError.insecureCredentialTransport
        }
        guard credentialOriginMatches(accessTokenOrigin, requestURL: url) else {
            throw CaveError.credentialOriginMismatch
        }
        return token
    }

    static func shouldClearStoredCredential(
        suppliedToken: String?,
        isSameEndpoint: Bool,
        nextURL: URL?
    ) -> Bool {
        guard suppliedToken == nil else { return false }
        if !isSameEndpoint { return true }
        guard let nextURL else { return true }
        return !isCredentialTransportSecure(nextURL)
    }

    static func saveAccessToken(_ token: String?, for baseURL: URL? = nil) {
        if let token, !token.isEmpty {
            KeychainStore.set(token, forKey: tokenKey)
            if let baseURL, let origin = credentialOrigin(for: baseURL) {
                KeychainStore.set(origin, forKey: tokenOriginKey)
            }
        } else {
            KeychainStore.remove(tokenKey)
            KeychainStore.remove(tokenOriginKey)
        }
    }
}

enum CaveError: LocalizedError {
    case notConfigured
    case insecureCredentialTransport
    case credentialOriginMismatch
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
        case .insecureCredentialTransport:
            return "This paired connection requires HTTPS. Use a secure Cave address and reconnect."
        case .credentialOriginMismatch:
            return "This address does not match the paired Cave. Pair this endpoint before sending credentials."
        case .badResponse(let code): return "Server returned status \(code)."
        case .serverResponse(let status, _, let message):
            let trimmed = message?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed?.isEmpty == false ? trimmed : "Server returned status \(status)."
        case .decoding(let msg): return "Could not read the response: \(msg)"
        case .transport(let msg): return msg
        }
    }
}
