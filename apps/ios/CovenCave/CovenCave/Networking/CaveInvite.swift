import Foundation

/// A parsed pairing input: where the desktop lives and (optionally) the
/// credential that unlocks its API. Pure + unit-tested. Accepts, in order:
/// - `covencave://connect?host=…&token=…` — the desktop's app invite link
///   (tap on device, or scan its QR)
/// - any http(s) invite URL carrying `coven_access_token`/`covenCaveToken` —
///   the browser-invite QR payload, pasted or scanned
/// - a bare host / host:port / full URL, with no credential (tokenless mode)
struct CaveInvite: Equatable {
    var host: String
    var token: String?

    static func parse(_ input: String) -> CaveInvite? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let lower = trimmed.lowercased()

        if lower.hasPrefix("covencave://") {
            guard let comps = URLComponents(string: trimmed),
                  let host = queryValue(comps, "host"), !host.isEmpty else { return nil }
            return CaveInvite(host: host, token: queryValue(comps, "token"))
        }

        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let comps = URLComponents(string: trimmed),
                  let hostname = comps.host, !hostname.isEmpty else { return nil }
            let token = queryValue(comps, "coven_access_token") ?? queryValue(comps, "covenCaveToken")
            // Keep scheme + host + port (CaveConnection trusts full URLs
            // verbatim); drop the path/query — the token is captured here.
            var normalized = "\(comps.scheme ?? "https")://\(hostname)"
            if let port = comps.port { normalized += ":\(port)" }
            return CaveInvite(host: normalized, token: token)
        }

        return CaveInvite(host: trimmed, token: nil)
    }

    /// Expiry baked into a signed token (`v1.<expiresAtMs>.<nonce>.<sig>`);
    /// nil for the legacy raw secret (which never expires). Client-side only —
    /// drives renewal timing and the re-pair message.
    static func tokenExpiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 4, parts[0] == "v1", let ms = Double(parts[1]) else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    private static func queryValue(_ comps: URLComponents, _ name: String) -> String? {
        let value = comps.queryItems?.first(where: { $0.name == name })?.value
        return (value?.isEmpty == false) ? value : nil
    }
}
