import Foundation

/// An inbox item from `GET /api/inbox`. The Reminders view shows the
/// `kind == "reminder"` items. Only the fields the app uses are modelled —
/// Codable ignores the rest (recurrence, media, source, …).
struct Reminder: Identifiable, Codable, Hashable {
    let id: String
    var kind: String
    var title: String
    var body: String?
    var status: String
    var fireAt: String?
    var firedAt: String?
    var createdAt: String?
    var updatedAt: String?

    /// Best timestamp to show / sort by.
    var whenISO: String? { fireAt ?? firedAt ?? createdAt }
}

struct InboxResponse: Decodable { let ok: Bool; let items: [Reminder] }
