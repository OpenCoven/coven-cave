import Foundation

/// A saved Library entry, unified across the reading + bookmarks lists for
/// display. (GitHub saves have their own Developer › GitHub section.)
struct LibraryItem: Identifiable, Hashable {
    let id: String
    let title: String
    let url: String
    let subtitle: String?   // article type / domain
    let familiar: String?
    let savedAt: String?    // ISO timestamp
}

// Raw decode shapes — only the fields the app shows.
struct LibraryReadingRaw: Decodable {
    let id: String
    let title: String?
    let url: String?
    let sourceType: String?
    let addedAt: String?
    let familiar: String?
}
struct LibraryBookmarkRaw: Decodable {
    let id: String
    let title: String?
    let url: String?
    let domain: String?
    let savedAt: String?
    let familiar: String?
}
struct LibraryReadingResponse: Decodable { let ok: Bool; let items: [LibraryReadingRaw] }
struct LibraryBookmarksResponse: Decodable { let ok: Bool; let items: [LibraryBookmarkRaw] }
