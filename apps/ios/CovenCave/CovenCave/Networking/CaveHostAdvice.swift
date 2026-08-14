import Foundation

/// Advisory classification of a typed or pasted desktop address. Catches the
/// classic dead ends BEFORE a doomed probe: `127.0.0.1` copied off the
/// desktop's own browser bar (that's the phone itself from here), Wi‑Fi-only
/// LAN addresses, `.local` mDNS names iPhones rarely resolve, and stray
/// spaces from copying a label along with the host. Advisory only — callers
/// must never gate the Connect button on it; the connect flow does the real
/// probing.
enum CaveHostAdvice: Equatable {
    /// Whitespace inside the address — almost always a copy that grabbed a
    /// label ("Cave 100.101.102.103").
    case hasSpace
    /// Loopback (`localhost`, `127.*`, `::1`, `0.0.0.0`) — on a phone this
    /// points at the phone, not the desktop.
    case loopback
    /// RFC1918 LAN space (`10.*`, `192.168.*`, `172.16–31.*`) — works only
    /// while both devices share the same network. Tailscale's CGNAT range
    /// (`100.64.0.0/10`) is deliberately NOT flagged: that's the good case.
    case lanAddress
    /// mDNS `.local` name — frequently unresolvable from iOS.
    case mdnsLocal

    var message: String {
        switch self {
        case .hasSpace:
            return "That has a space — paste just the address."
        case .loopback:
            return "That address is this phone, not your desktop. Use the desktop’s Tailscale address (100.x or *.ts.net) from “Open on phone”."
        case .lanAddress:
            return "That looks like a Wi‑Fi-only address — it works just while both devices share a network. Prefer the Tailscale address so it works anywhere."
        case .mdnsLocal:
            return "“.local” names often don’t resolve from iPhones. Prefer the Tailscale address from “Open on phone”."
        }
    }

    /// Classify raw field input. Returns nil for anything plausible — the
    /// advice only speaks up for addresses that are provably wrong-shaped.
    static func evaluate(_ input: String) -> CaveHostAdvice? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.contains(" ") { return .hasSpace }
        let host = hostPart(of: trimmed)
        guard !host.isEmpty else { return nil }
        if isLoopback(host) { return .loopback }
        if host.hasSuffix(".local") { return .mdnsLocal }
        if isPrivateLANAddress(host) { return .lanAddress }
        return nil
    }

    /// Extract the bare host from whatever shape the field holds: an optional
    /// scheme, path/query tail, `host:port`, or a bracketed IPv6 literal.
    static func hostPart(of address: String) -> String {
        var s = address.lowercased()
        for scheme in ["covencave://", "https://", "http://"] where s.hasPrefix(scheme) {
            s = String(s.dropFirst(scheme.count))
            break
        }
        if let slash = s.firstIndex(of: "/") { s = String(s[..<slash]) }
        if let query = s.firstIndex(of: "?") { s = String(s[..<query]) }
        if s.hasPrefix("[") {
            // Bracketed IPv6, possibly with a port after the bracket.
            guard let close = s.firstIndex(of: "]") else { return String(s.dropFirst()) }
            return String(s[s.index(after: s.startIndex)..<close])
        }
        // Exactly one colon separates host:port; two or more is a bare IPv6
        // literal that must keep its colons.
        if s.filter({ $0 == ":" }).count == 1, let colon = s.firstIndex(of: ":") {
            s = String(s[..<colon])
        }
        return s
    }

    private static func isLoopback(_ host: String) -> Bool {
        if host == "localhost" || host == "::1" || host == "0.0.0.0" { return true }
        if let octets = ipv4Octets(host) { return octets[0] == 127 }
        return false
    }

    private static func isPrivateLANAddress(_ host: String) -> Bool {
        guard let o = ipv4Octets(host) else { return false }
        if o[0] == 10 { return true }
        if o[0] == 192, o[1] == 168 { return true }
        if o[0] == 172, (16...31).contains(o[1]) { return true }
        // 100.64.0.0/10 (Tailscale CGNAT) intentionally passes — that's the
        // address we WANT people to use.
        return false
    }

    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var octets: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy(\.isNumber), let value = Int(part),
                  (0...255).contains(value)
            else { return nil }
            octets.append(value)
        }
        return octets
    }
}
