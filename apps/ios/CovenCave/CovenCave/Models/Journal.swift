import Foundation

/// One day in the journal list (`GET /api/journal` → `days`). Only the fields
/// the app shows are modelled.
struct JournalDay: Identifiable, Codable, Hashable {
    let date: String          // yyyy-MM-dd
    var preview: String?
    var reflectedBy: String?
    var modified: String?
    var id: String { date }
}

/// A day's reflection (`GET /api/journal?date=` → `entry`). The route always
/// returns an `entry` (empty reflection when the day has none).
struct JournalEntry: Codable, Hashable {
    var reflectedBy: String?
    var generatedAt: String?
    var reflection: String
}

struct JournalDaysResponse: Decodable { let ok: Bool; let days: [JournalDay] }
struct JournalDayResponse: Decodable { let ok: Bool; let exists: Bool; let entry: JournalEntry }
