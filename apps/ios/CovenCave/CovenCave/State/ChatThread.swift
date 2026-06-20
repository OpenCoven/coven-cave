import Foundation
import Observation

/// A message as shown in the thread UI. For group threads, assistant messages
/// carry the `familiarId` that produced them so we can attribute + colour them.
struct DisplayMessage: Identifiable, Codable, Hashable {
    enum Role: String, Codable { case user, assistant }
    var id: String = UUID().uuidString
    var role: Role
    var familiarId: String?
    var text: String
    var streaming: Bool = false
    var isError: Bool = false
    var createdAt: Date = Date()
}

/// Plain Codable snapshot used for on-disk persistence.
struct ThreadSnapshot: Codable, Identifiable {
    var id: String
    var title: String
    var familiarIds: [String]
    var sessionIds: [String: String]
    var messages: [DisplayMessage]
    var updatedAt: Date
}

/// A conversation thread. One familiar = a direct chat; several = a group.
///
/// The server has no multi-familiar concept, so a group is N parallel server
/// sessions (one `sessionId` per familiar) presented in a single UI. Sending a
/// message fans the prompt out to every familiar concurrently and streams each
/// reply into its own attributed bubble.
@Observable
@MainActor
final class ChatThread: Identifiable, Hashable {
    nonisolated static func == (lhs: ChatThread, rhs: ChatThread) -> Bool { lhs === rhs }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(self)) }

    let id: String
    var title: String
    var familiarIds: [String]
    var sessionIds: [String: String]
    var messages: [DisplayMessage]
    var updatedAt: Date

    var isGroup: Bool { familiarIds.count > 1 }
    var activeStreams: Int { messages.filter { $0.streaming }.count }
    var isStreaming: Bool { activeStreams > 0 }

    init(id: String = UUID().uuidString,
         title: String,
         familiarIds: [String],
         sessionIds: [String: String] = [:],
         messages: [DisplayMessage] = []) {
        self.id = id
        self.title = title
        self.familiarIds = familiarIds
        self.sessionIds = sessionIds
        self.messages = messages
        self.updatedAt = Date()
    }

    convenience init(snapshot s: ThreadSnapshot) {
        self.init(id: s.id, title: s.title, familiarIds: s.familiarIds,
                  sessionIds: s.sessionIds, messages: s.messages)
        self.updatedAt = s.updatedAt
    }

    var snapshot: ThreadSnapshot {
        ThreadSnapshot(id: id, title: title, familiarIds: familiarIds,
                       sessionIds: sessionIds, messages: messages, updatedAt: updatedAt)
    }

    /// Send a user message and stream replies from every familiar in the thread.
    func send(_ text: String, client: CaveClient, onChange: @escaping () -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messages.append(DisplayMessage(role: .user, familiarId: nil, text: trimmed))
        updatedAt = Date()
        onChange()

        for familiarId in familiarIds {
            let placeholder = DisplayMessage(role: .assistant, familiarId: familiarId,
                                             text: "", streaming: true)
            messages.append(placeholder)
            let messageId = placeholder.id
            Task { await self.stream(familiarId: familiarId, prompt: trimmed,
                                     into: messageId, client: client, onChange: onChange) }
        }
    }

    private func stream(familiarId: String, prompt: String, into messageId: String,
                        client: CaveClient, onChange: @escaping () -> Void) async {
        let body = CaveClient.SendBody(familiarId: familiarId, prompt: prompt,
                                       sessionId: sessionIds[familiarId])
        do {
            for try await event in client.sendStream(body) {
                switch event {
                case .session(let sid):
                    if !sid.isEmpty { sessionIds[familiarId] = sid }
                case .assistantChunk(let chunk):
                    mutate(messageId) { $0.text += chunk }
                case .done(let isError, let sid):
                    if let sid, !sid.isEmpty { sessionIds[familiarId] = sid }
                    mutate(messageId) { $0.streaming = false; if isError { $0.isError = true } }
                case .error(let message):
                    mutate(messageId) {
                        if $0.text.isEmpty { $0.text = message }
                        $0.isError = true; $0.streaming = false
                    }
                default:
                    break
                }
            }
            mutate(messageId) { $0.streaming = false }
        } catch {
            mutate(messageId) {
                if $0.text.isEmpty { $0.text = error.localizedDescription }
                $0.isError = true; $0.streaming = false
            }
        }
        updatedAt = Date()
        onChange()
    }

    private func mutate(_ messageId: String, _ body: (inout DisplayMessage) -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
        body(&messages[idx])
    }
}
