import Foundation

struct Input: Decodable {
    struct Turn: Decodable {
        var id: String
        var parentId: String?
        var role: String?
        var createdAt: String?
    }
    var conversationId: String
    var turns: [Turn]
    var activeLeafId: String?
    var resolveBranch: Bool?
    var partial: Bool?
}

let inputs = try JSONDecoder().decode([Input].self, from: FileHandle.standardInput.readDataToEndOfFile())
let results: [[String: Any]] = inputs.map { input in
    let turns = input.turns.map {
        ChapterSourceTurn(id: $0.id, parentId: $0.parentId, role: $0.role ?? "user", createdAt: $0.createdAt)
    }
    let branch = input.resolveBranch == true
        ? ConversationChapters.activeBranch(turns, activeLeafId: input.activeLeafId) : turns
    let index = branch.map {
        ConversationChapters.build(conversationId: input.conversationId, activeBranch: $0, partial: input.partial ?? false)
    } ?? .unavailable
    return [
        "status": String(describing: index.status),
        "chapters": index.chapters.map {
            ["id": $0.id, "conversationId": $0.conversationId, "day": $0.day,
             "firstTurnId": $0.firstTurnId, "lastTurnId": $0.lastTurnId, "turnCount": $0.turnCount] as [String: Any]
        },
        "branch": branch?.map(\.id) as Any? ?? NSNull(),
    ]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
