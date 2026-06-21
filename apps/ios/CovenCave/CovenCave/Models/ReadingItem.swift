import Foundation

/// One entry in the Cave library's reading list — the data behind the Read tab.
/// Mirrors `LibraryReadingItem` (src/lib/library-types.ts). Items are created on
/// the desktop (e.g. `/save <url> reading`); the phone reads and curates them.
///
/// `status` and `sourceType` are decoded as raw strings (BoardCard-style) so an
/// unexpected value from a newer desktop never fails the whole decode.
struct ReadingItem: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var url: String?
    var author: String?
    var statusRaw: String
    var sourceTypeRaw: String
    var progress: Double?
    var notes: String?
    var tags: [String]?
    var addedAt: String?
    var finishedAt: String?
    var familiar: String?

    enum CodingKeys: String, CodingKey {
        case id, title, url, author
        case statusRaw = "status"
        case sourceTypeRaw = "sourceType"
        case progress, notes, tags, addedAt, finishedAt, familiar
    }

    var status: ReadingStatus { ReadingStatus(lenient: statusRaw) }
    var sourceType: ReadingSourceType { ReadingSourceType(raw: sourceTypeRaw) }
    var tagList: [String] { tags ?? [] }

    /// The link, if it's a usable web URL.
    var link: URL? {
        guard let url, let u = URL(string: url),
              let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https"
        else { return nil }
        return u
    }

    /// Bare host for the byline, e.g. "arxiv.org".
    var domain: String? {
        link?.host.map { $0.hasPrefix("www.") ? String($0.dropFirst(4)) : $0 }
    }

    var addedDate: Date? { addedAt.flatMap(ReadingDates.parse) }

    var progressPercent: Int? { progress.map { Int($0.rounded()) } }
}

/// Where an item came from / how to read it. Unknown → `.other`.
enum ReadingSourceType: String, CaseIterable {
    case article, paper, book, thread, video, other

    init(raw: String) { self = ReadingSourceType(rawValue: raw.lowercased()) ?? .other }

    var label: String {
        switch self {
        case .article: return "Article"
        case .paper: return "Paper"
        case .book: return "Book"
        case .thread: return "Thread"
        case .video: return "Video"
        case .other: return "Link"
        }
    }

    var symbol: String {
        switch self {
        case .article: return "newspaper"
        case .paper: return "graduationcap"
        case .book: return "book"
        case .thread: return "bubble.left.and.text.bubble.right"
        case .video: return "play.rectangle"
        case .other: return "doc.text"
        }
    }
}

/// Reading progress lifecycle. Legacy `"read"` folds to `.done`; unknown →
/// `.wantToRead` (matches the web list's normalisation).
enum ReadingStatus: String, CaseIterable, Identifiable {
    case wantToRead = "want-to-read"
    case reading
    case done
    case abandoned

    var id: String { rawValue }

    init(lenient raw: String) {
        if raw == "read" { self = .done; return }
        self = ReadingStatus(rawValue: raw) ?? .wantToRead
    }

    var label: String {
        switch self {
        case .wantToRead: return "Want to read"
        case .reading: return "Reading"
        case .done: return "Read"
        case .abandoned: return "Abandoned"
        }
    }

    /// Short form for compact filter chips and badges.
    var chipLabel: String {
        switch self {
        case .wantToRead: return "Want"
        case .reading: return "Reading"
        case .done: return "Read"
        case .abandoned: return "Done-ish"
        }
    }

    var symbol: String {
        switch self {
        case .wantToRead: return "bookmark"
        case .reading: return "book"
        case .done: return "checkmark.circle.fill"
        case .abandoned: return "xmark.bin"
        }
    }
}

/// ISO-8601 parsing that tolerates fractional seconds (the store writes
/// `…789Z`) and plain second precision.
enum ReadingDates {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String) -> Date? {
        withFraction.date(from: s) ?? plain.date(from: s)
    }
}
