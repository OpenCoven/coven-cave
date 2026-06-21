import Foundation

// Models backing the Developer tab: projects, the file tree, file contents,
// code search, and GitHub activity. All mirror the desktop REST contracts the
// web Code workspace already uses (/api/projects, /api/project-tree,
// /api/project-file, /api/project/search, /api/github/*).

// MARK: - Projects

/// A configured project root (`GET /api/projects` → `{ projects: [...] }`).
struct ProjectInfo: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var root: String
    var color: String?
    var updatedAt: String?
}

struct ProjectsResponse: Decodable { var ok: Bool; var projects: [ProjectInfo] }

// MARK: - File tree

/// One entry in a project's file tree (`GET /api/project-tree`). `children` is
/// present only for directories that were expanded server-side.
struct TreeEntry: Codable, Identifiable, Hashable {
    var name: String
    var path: String
    var isDir: Bool
    var children: [TreeEntry]?

    var id: String { path }
}

struct TreeResponse: Decodable { var ok: Bool; var entries: [TreeEntry]?; var error: String? }

// MARK: - File contents

/// A read file (`GET /api/project-file?path=`). Text files carry `content`;
/// images carry a base64 `dataUrl`.
struct FileContent: Decodable {
    var ok: Bool
    var kind: String?         // "text" | "image"
    var content: String?
    var dataUrl: String?
    var mimeType: String?
    var size: Int?
    var error: String?

    var isImage: Bool { kind == "image" }
}

struct FileWriteResponse: Decodable { var ok: Bool; var size: Int?; var error: String? }

// MARK: - Code search

struct SearchMatch: Decodable, Identifiable, Hashable {
    var line: Int             // 1-based line number
    var column: Int?
    var preview: String       // matched line text
    var id: Int { line }
}

/// One file group from `/api/project/search`. `path` is **relative** to the
/// searched root, so absolute path = `root + "/" + path`.
struct SearchFile: Decodable, Identifiable, Hashable {
    var path: String
    var matches: [SearchMatch]
    var id: String { path }
}

struct SearchResponse: Decodable {
    var ok: Bool
    var repo: Bool?
    var files: [SearchFile]?
    var totalMatches: Int?
    var truncated: Bool?
    var error: String?
}

// MARK: - GitHub

struct GitHubItem: Decodable, Identifiable, Hashable {
    var kind: String          // "pr" | "issue" | "review_request" | "notification"
    var id: String
    var title: String
    var repo: String
    var number: Int?
    var url: String
    var state: String?
    var updatedAt: String
    var draft: Bool?
    var labels: [String]?

    var isPull: Bool { kind == "pr" || kind == "review_request" }
}

struct GitHubActivityResponse: Decodable {
    var ok: Bool
    var authed: Bool?
    var login: String?
    var items: [GitHubItem]?
    var error: String?
    var hint: String?
}

struct GitHubPerson: Decodable, Hashable {
    var login: String
    var avatarUrl: String?
    var url: String?
}

struct GitHubLabel: Decodable, Hashable {
    var name: String
    var color: String
}

struct GitHubItemDetail: Decodable {
    var ok: Bool
    var title: String?
    var number: Int?
    var state: String?
    var isPull: Bool?
    var merged: Bool?
    var draft: Bool?
    var body: String?
    var author: GitHubPerson?
    var assignees: [GitHubPerson]?
    var labels: [GitHubLabel]?
    var createdAt: String?
    var updatedAt: String?
    var htmlUrl: String?
    var comments: Int?
    var error: String?
}
