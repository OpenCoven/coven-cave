import Foundation

/// Placement logic for the transcript's "New Messages" divider — the
/// iMessage/Telegram-style marker above the first reply that arrived since
/// the operator last viewed this conversation. Pure functions so the
/// placement rules are unit-testable.
enum UnreadMarker {
    /// The id of the first unseen message: the earliest assistant reply
    /// created strictly after `seenBoundary`. A nil boundary (history not
    /// tracked yet) means no divider — new familiars are seeded as "seen
    /// now", so the whole backlog never reads as unread. The operator's own
    /// sends and local system notes never count as unseen.
    static func firstUnseenId(messages: [DisplayMessage], seenBoundary: Date?) -> String? {
        guard let boundary = seenBoundary else { return nil }
        return messages.first { $0.role == .assistant && $0.createdAt > boundary }?.id
    }

    /// How many messages sit at or after the divider. Kept for badges and
    /// regression visibility; initial chat presentation still opens at the
    /// latest message so returning to a conversation continues from the bottom.
    static func unseenRunLength(messages: [DisplayMessage], firstUnseenId: String?) -> Int {
        guard let id = firstUnseenId,
              let index = messages.firstIndex(where: { $0.id == id }) else { return 0 }
        return messages.count - index
    }
}
