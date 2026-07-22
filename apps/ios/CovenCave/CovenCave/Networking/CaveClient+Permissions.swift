import Foundation

/// Permissions-console REST calls: familiar project grants, grant proposals
/// (with the 30s undo window), the audit log, and the desktop's mobile
/// write-access opt-ins. Mutations mirror the web console's payloads exactly;
/// the server enforces who may call them (loopback desktop always, this phone
/// only behind the desktop's "Allow permission changes from phone" opt-in),
/// so every call decodes `{ ok, error }` and surfaces the server's guidance
/// verbatim when refused.
extension CaveClient {
    private static let permissionsSharedSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    private func permissionsRequest(
        _ path: String,
        method: String = "GET",
        body: Data? = nil
    ) throws -> URLRequest {
        guard let base = connection.baseURL else { throw CaveError.notConfigured }
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = CaveConnection.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func permissionsData(_ req: URLRequest) async throws -> Data {
        // 4xx bodies are structured `{ ok:false, error }` — return them so
        // callers can show the server's own message (e.g. "enable … in
        // desktop Settings") instead of a generic failure.
        let (data, _) = try await Self.permissionsSharedSession.data(for: req)
        return data
    }

    private func permissionsDecode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw CaveError.decoding(String(describing: error)) }
    }

    // MARK: - Reads

    /// One fetch renders the whole console: grants, access groups (for
    /// effective "via group" access), the supreme familiar, the audit window,
    /// and whether this phone may mutate any of it.
    func projectGrants() async throws -> ProjectGrantsResponse {
        let data = try await permissionsData(try permissionsRequest("api/project-grants"))
        let decoded = try permissionsDecode(ProjectGrantsResponse.self, data)
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t load permissions.")
        }
        return decoded
    }

    func grantProposals() async throws -> [GrantProposal] {
        let data = try await permissionsData(try permissionsRequest("api/grant-proposals"))
        let decoded = try permissionsDecode(GrantProposalsResponse.self, data)
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t load grant requests.")
        }
        return decoded.proposals ?? []
    }

    /// The desktop's opt-ins for what this phone may write.
    func mobilePermissions() async throws -> (grantMutations: Bool, fileWrites: Bool) {
        let data = try await permissionsData(try permissionsRequest("api/mobile-permissions"))
        let decoded = try permissionsDecode(MobilePermissionsResponse.self, data)
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t load mobile permissions.")
        }
        return (decoded.grantMutations == true, decoded.fileWrites == true)
    }

    // MARK: - Mutations (server-gated behind the desktop opt-in)

    func grantProject(
        targetFamiliarId: String,
        projectId: String,
        access: ProjectAccessLevel
    ) async throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "targetFamiliarId": targetFamiliarId,
            "projectId": projectId,
            "access": access.rawValue,
        ])
        let req = try permissionsRequest("api/project-grants", method: "POST", body: payload)
        let decoded = try permissionsDecode(PermissionMutationResponse.self, try await permissionsData(req))
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t update access.")
        }
    }

    func revokeProject(targetFamiliarId: String, projectId: String) async throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "targetFamiliarId": targetFamiliarId,
            "projectId": projectId,
        ])
        let req = try permissionsRequest("api/project-grants", method: "DELETE", body: payload)
        let decoded = try permissionsDecode(PermissionMutationResponse.self, try await permissionsData(req))
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t revoke access.")
        }
    }

    /// decision: "accepted" | "rejected" | "undo" — accepted parks the grant
    /// in a 30s undo window before it materializes.
    @discardableResult
    func decideProposal(id: String, decision: String) async throws -> GrantProposal? {
        let payload = try JSONSerialization.data(withJSONObject: ["decision": decision])
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let req = try permissionsRequest(
            "api/grant-proposals/\(encodedId)", method: "PATCH", body: payload
        )
        let decoded = try permissionsDecode(GrantProposalDecisionResponse.self, try await permissionsData(req))
        guard decoded.ok else {
            throw CaveError.transport(decoded.error ?? "Couldn’t update the request.")
        }
        return decoded.proposal
    }
}
