import Foundation

/// The caller's intended target, captured before any dispatch suspension.
struct ChatDispatchBinding: Equatable {
    let threadId: String
    let projectRoot: String?
    let familiarIds: [String]
    private let roster: [String]
    private let sessionIds: [String: String]

    @MainActor
    init(thread: ChatThread, familiarIds: [String]? = nil) {
        threadId = thread.id
        projectRoot = thread.projectRoot
        let recipients = familiarIds ?? thread.familiarIds
        self.familiarIds = recipients
        roster = thread.familiarIds
        sessionIds = thread.sessionIds.filter { recipients.contains($0.key) }
    }

    @MainActor
    func matches(_ thread: ChatThread, includingSessions: Bool = false) -> Bool {
        thread.id == threadId
            && thread.projectRoot == projectRoot
            && thread.familiarIds == roster
            && familiarIds.allSatisfy { roster.contains($0) }
            && sessionIds.allSatisfy { thread.sessionIds[$0.key] == $0.value }
            && (!includingSessions || familiarIds.allSatisfy {
                thread.sessionIds[$0] == sessionIds[$0]
            })
    }
}
