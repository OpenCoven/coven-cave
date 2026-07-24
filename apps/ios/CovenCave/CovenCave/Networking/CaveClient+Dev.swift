import Foundation

extension CaveClient {
    private static let devSharedSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 25
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    /// Project roots remain shared by Terminal and the chat Projects panel.
    func projects() async throws -> [ProjectInfo] {
        guard let base = connection.baseURL else { throw CaveError.notConfigured }
        var request = URLRequest(url: base.appendingPathComponent("api/projects"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = CaveConnection.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await Self.devSharedSession.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw CaveError.badResponse(http.statusCode)
        }
        do {
            return try JSONDecoder().decode(ProjectsResponse.self, from: data).projects
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }
}
