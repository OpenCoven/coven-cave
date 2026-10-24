import Foundation

/// `@`-file mentions in a one-to-one chat with a project (#6104), ported from
/// the desktop composer's `src/lib/file-mention.ts` (CHAT-D1-04).
///
/// Typing `@` lists files from the chat's project. Picking one inserts
/// `@<repo-relative path> `, the Claude Code convention the desktop uses, and
/// the send carries those paths so the server can hand the harness absolute
/// paths it is allowed to Read.
enum FileMention {
    /// Hard cap on mentions per send, the same as the desktop and the server.
    static let maxPerSend = 10
    /// How many ranked matches the picker shows.
    static let resultLimit = 12

    /// Case-insensitive fuzzy filter over repo-relative paths, ranked like the
    /// desktop's `filterFileMentions`:
    ///   0, the file name starts with the query (`@cha` → chat-view.tsx)
    ///   1, the file name contains it
    ///   2, the full path contains it
    ///   3, the query's characters appear in order in the path (weakest)
    /// Ties go to the shorter path, then the lexically smaller one. An empty
    /// query returns the head of the index unranked.
    static func filter(_ files: [String], query: String, limit: Int = resultLimit) -> [String] {
        guard limit > 0 else { return [] }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return Array(files.prefix(limit)) }

        var scored: [(file: String, rank: Int)] = []
        for file in files {
            let path = file.lowercased()
            let base = fileName(path)
            let rank: Int
            if base.hasPrefix(q) { rank = 0 }
            else if base.contains(q) { rank = 1 }
            else if path.contains(q) { rank = 2 }
            else if isSubsequence(q, of: path) { rank = 3 }
            else { continue }
            scored.append((file, rank))
        }
        // UTF-16 length and order, as JavaScript compares strings.
        scored.sort { a, b in
            if a.rank != b.rank { return a.rank < b.rank }
            let aLength = a.file.utf16.count, bLength = b.file.utf16.count
            if aLength != bLength { return aLength < bLength }
            return a.file.utf16.lexicographicallyPrecedes(b.file.utf16)
        }
        return scored.prefix(limit).map(\.file)
    }

    /// The repo-relative paths a prompt mentions, in order, without repeats,
    /// at most `maxPerSend`.
    ///
    /// The desktop sends only the paths picked in this draft. The phone reads
    /// them back from the text that is actually sent instead, so a retry, a
    /// queued replay and a draft restored after relaunch all carry the same
    /// files. A token counts when it starts the text or follows whitespace,
    /// like the picker's own boundary, so `val@example.com` never does.
    /// Trailing sentence punctuation is dropped. The server remains the
    /// authority: it keeps only relative paths to real files inside the
    /// chat's validated root and ignores everything else.
    static func paths(in prompt: String) -> [String] {
        var found: [String] = []
        for word in prompt.split(whereSeparator: { $0.isWhitespace }) {
            guard word.hasPrefix("@") else { continue }
            var path = String(word.dropFirst())
            while let last = path.last, trailingPunctuation.contains(last) { path.removeLast() }
            guard !path.isEmpty, !path.contains("@"), !path.hasPrefix("/") else { continue }
            if !found.contains(path) { found.append(path) }
            if found.count == maxPerSend { break }
        }
        return found
    }

    /// The last path component: what a file row shows as its title.
    static func fileName(_ path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return path }
        return String(path[path.index(after: slash)...])
    }

    /// The folder a file sits in, or nil at the project root: the row subtitle.
    static func folder(_ path: String) -> String? {
        guard let slash = path.lastIndex(of: "/"), slash > path.startIndex else { return nil }
        return String(path[..<slash])
    }

    private static let trailingPunctuation: Set<Character> = [",", ".", ";", ":", "!", "?", ")", "]", "}", "\"", "'"]

    /// True when every character of `query` appears in `target` in order.
    private static func isSubsequence(_ query: String, of target: String) -> Bool {
        var remaining = query.makeIterator()
        var next = remaining.next()
        for character in target where character == next {
            next = remaining.next()
            if next == nil { return true }
        }
        return next == nil
    }
}

/// `GET /api/project/files?root=` (CHAT-D1-04): the git-visible files under a
/// project root, relative to it. A root outside a git work tree answers
/// `{ ok: true, repo: false }`, which the composer treats as "no files".
struct ProjectFilesResponse: Decodable {
    var ok: Bool?
    var repo: Bool?
    var files: [String]?
    var truncated: Bool?

    /// The usable file list: empty unless the server listed a repository.
    var indexedFiles: [String] {
        ok == true && repo == true ? (files ?? []) : []
    }
}
