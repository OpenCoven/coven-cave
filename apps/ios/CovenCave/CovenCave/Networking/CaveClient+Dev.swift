import Foundation

extension CaveClient {
    /// Project roots remain shared by Terminal and the chat Projects panel.
    func projects() async throws -> [ProjectInfo] {
        try await projects(familiarId: nil)
    }

    /// Returns only projects the selected familiar can launch in.
    func projects(familiarId: String) async throws -> [ProjectInfo] {
        try await projects(familiarId: Optional(familiarId))
    }

    /// Returns projects every selected familiar can launch in, with the least
    /// permissive effective access retained for display.
    func projects(familiarIds: [String]) async throws -> [ProjectInfo] {
        let orderedIDs = ChatProjectSelection.familiarKey(familiarIds)
        guard !orderedIDs.isEmpty else { return [] }

        var scopes: [[ProjectInfo]] = []
        scopes.reserveCapacity(orderedIDs.count)
        for familiarID in orderedIDs {
            scopes.append(try await projects(familiarId: familiarID))
        }
        return ChatProjectSelection.sharedProjects(scopes)
    }

    private func projects(familiarId: String?) async throws -> [ProjectInfo] {
        guard let base = connection.baseURL else { throw CaveError.notConfigured }
        let endpoint = base.appendingPathComponent("api/projects")
        var url = endpoint
        if let familiarId {
            guard var components = URLComponents(
                url: endpoint,
                resolvingAgainstBaseURL: false
            ) else {
                throw CaveError.notConfigured
            }
            components.queryItems = [URLQueryItem(name: "familiarId", value: familiarId)]
            guard let scopedURL = components.url else { throw CaveError.notConfigured }
            url = scopedURL
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = CaveConnection.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw Self.serverResponseError(statusCode: http.statusCode, data: data)
        }
        do {
            return try JSONDecoder().decode(ProjectsResponse.self, from: data).projects
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }
}
