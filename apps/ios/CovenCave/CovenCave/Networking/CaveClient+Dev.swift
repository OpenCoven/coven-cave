import Foundation

/// Developer-tab REST calls (code browsing/editing, search, GitHub). Kept in
/// its own extension so it stays self-contained: it builds requests straight
/// from `connection.baseURL` (with proper query-item encoding) rather than the
/// core client's path-only helper.
extension CaveClient {
    private var devSession: URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }

    /// Build a request against `<base>/<path>` with optional query items.
    private func devRequest(
        _ path: String,
        query: [URLQueryItem] = [],
        method: String = "GET",
        body: Data? = nil
    ) throws -> URLRequest {
        guard let base = connection.baseURL else { throw CaveError.notConfigured }
        guard var comps = URLComponents(url: base.appendingPathComponent(path),
                                        resolvingAgainstBaseURL: false) else {
            throw CaveError.notConfigured
        }
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw CaveError.notConfigured }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func devData(_ req: URLRequest) async throws -> Data {
        let (data, resp) = try await devSession.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            // Many dev routes answer 4xx with a JSON `{ ok:false, error }` body;
            // hand the body back so callers can decode the message.
            return data
        }
        return data
    }

    private func devDecode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw CaveError.decoding(String(describing: error)) }
    }

    // MARK: - Projects

    func projects() async throws -> [ProjectInfo] {
        let data = try await devData(try devRequest("api/projects"))
        return try devDecode(ProjectsResponse.self, data).projects
    }

    // MARK: - File tree

    func projectTree(root: String, depth: Int = 1) async throws -> [TreeEntry] {
        let req = try devRequest("api/project-tree", query: [
            .init(name: "root", value: root),
            .init(name: "depth", value: String(depth)),
        ])
        let decoded = try devDecode(TreeResponse.self, try await devData(req))
        if let entries = decoded.entries { return entries }
        throw CaveError.transport(decoded.error ?? "Couldn’t read the directory.")
    }

    // MARK: - File contents

    func readFile(path: String) async throws -> FileContent {
        let req = try devRequest("api/project-file", query: [.init(name: "path", value: path)])
        return try devDecode(FileContent.self, try await devData(req))
    }

    @discardableResult
    func writeFile(path: String, content: String) async throws -> Int {
        let payload = try JSONEncoder().encode(["path": path, "content": content])
        let req = try devRequest("api/project-file", method: "POST", body: payload)
        let decoded = try devDecode(FileWriteResponse.self, try await devData(req))
        if decoded.ok { return decoded.size ?? 0 }
        throw CaveError.transport(decoded.error ?? "Save failed.")
    }

    // MARK: - Code search

    func searchProject(root: String, query: String) async throws -> SearchResponse {
        let req = try devRequest("api/project/search", query: [
            .init(name: "root", value: root),
            .init(name: "q", value: query),
        ])
        return try devDecode(SearchResponse.self, try await devData(req))
    }

    // MARK: - GitHub

    func githubActivity() async throws -> GitHubActivityResponse {
        try devDecode(GitHubActivityResponse.self,
                      try await devData(try devRequest("api/github/activity")))
    }

    func githubItem(repo: String, number: Int) async throws -> GitHubItemDetail {
        let req = try devRequest("api/github/item", query: [
            .init(name: "repo", value: repo),
            .init(name: "number", value: String(number)),
        ])
        return try devDecode(GitHubItemDetail.self, try await devData(req))
    }

    /// Conversation timeline + (for PRs) inline review threads with resolve
    /// state. Mirrors the desktop GitHub view's comments fetch.
    func githubComments(repo: String, number: Int, isPull: Bool) async throws -> GitHubCommentsResponse {
        var query: [URLQueryItem] = [
            .init(name: "repo", value: repo),
            .init(name: "number", value: String(number)),
        ]
        if isPull { query.append(.init(name: "isPull", value: "1")) }
        let req = try devRequest("api/github/comments", query: query)
        return try devDecode(GitHubCommentsResponse.self, try await devData(req))
    }

    /// Post a reply to the conversation timeline (PAT required server-side).
    func postGithubComment(repo: String, number: Int, body: String) async throws -> GitHubCommentPostResponse {
        let payload = try JSONSerialization.data(withJSONObject: [
            "repo": repo, "number": number, "body": body,
        ])
        let req = try devRequest("api/github/comment", method: "POST", body: payload)
        return try devDecode(GitHubCommentPostResponse.self, try await devData(req))
    }

    /// Resolve / unresolve a PR review thread (PAT required server-side).
    func resolveGithubThread(threadId: String, resolved: Bool) async throws -> GitHubResolveResponse {
        let payload = try JSONSerialization.data(withJSONObject: [
            "threadId": threadId, "resolved": resolved,
        ])
        let req = try devRequest("api/github/resolve-thread", method: "POST", body: payload)
        return try devDecode(GitHubResolveResponse.self, try await devData(req))
    }
}
