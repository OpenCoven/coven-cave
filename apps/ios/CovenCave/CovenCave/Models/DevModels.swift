import Foundation

struct ProjectInfo: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var root: String
    var color: String?
    var updatedAt: String?
}

struct ProjectsResponse: Decodable {
    var ok: Bool
    var projects: [ProjectInfo]
}
