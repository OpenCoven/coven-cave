import Foundation

struct ProjectInfo: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var root: String
    var color: String?
    var updatedAt: String?
    var access: ProjectAccessLevel? = nil
}

struct ProjectsResponse: Decodable, Sendable {
    var ok: Bool
    var projects: [ProjectInfo]
}
