import Foundation

/// The conversation and desktop that actually supplied a message. Persist only
/// this address, never a full result. Current thread routing is not provenance.
struct ToolOutputReference: Codable, Hashable {
    let sessionId: String
    let endpoint: String

    init?(sessionId: String?, connection: CaveConnection) {
        guard let sessionId, !sessionId.isEmpty,
              let endpoint = Self.endpoint(for: connection) else { return nil }
        self.sessionId = sessionId
        self.endpoint = endpoint
    }

    func matches(_ connection: CaveConnection?) -> Bool {
        guard let connection else { return false }
        return Self.endpoint(for: connection) == endpoint
    }

    private static func endpoint(for connection: CaveConnection) -> String? {
        guard let url = connection.baseURL,
              let origin = CaveConnection.credentialOrigin(for: url),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        // Keep a deployment's base path distinct; discard user info, query and
        // fragment so credentials can never enter this snapshot metadata.
        let path = parts.percentEncodedPath
        return origin + (path.hasSuffix("/") ? String(path.dropLast()) : path)
    }
}
