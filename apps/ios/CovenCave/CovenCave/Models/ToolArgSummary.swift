import Foundation

/// One-line argument summaries for tool activity chips — `ls -la src`,
/// `src/lib/foo.ts` — derived from a tool call's input payload.
///
/// Tool inputs reach the app as *pretty-printed* JSON: the server stringifies
/// them with two-space indentation (`formatToolInputValue`, see
/// `src/lib/chat-tool-events.ts`), so the first line of a real payload is a
/// bare `{`. Reading the first line — what the activity fold used to do — put
/// a literal "{" under every tool call in the app.
///
/// Mirrors `src/lib/tool-arg-summary.ts` so a call reads the same on iOS as it
/// does in the web chat. Keep the two in step: the preferred-key list and the
/// command-first rule are the shared contract.
enum ToolArgSummary {
    /// Chips are a single line — long enough to identify a call, short enough
    /// not to crowd the tool name beside it.
    static let maxChars = 140

    /// Well-known argument keys, most identifying first.
    private static let preferredKeys = [
        "file_path", "path", "command", "pattern", "url",
        "query", "prompt", "description", "skill", "notebook_path",
    ]

    /// Shell-ish tools whose `command` key is the headline argument.
    private static func isCommandFirst(_ name: String) -> Bool {
        let lowered = name.lowercased()
        return ["bash", "shell", "terminal", "exec"].contains { lowered.hasPrefix($0) }
    }

    private static func keyOrder(for name: String) -> [String] {
        guard isCommandFirst(name) else { return preferredKeys }
        return ["command"] + preferredKeys.filter { $0 != "command" }
    }

    /// Summarise a tool's input payload into one short line, or nil when the
    /// payload carries nothing worth showing.
    static func summary(name: String, input: String?, max: Int = maxChars) -> String? {
        let raw = input?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return nil }

        if let parsed = parseJSON(raw) {
            if let record = parsed as? [String: Any] {
                return summarize(name: name, record: record, max: max)
            }
            if let list = parsed as? [Any] {
                return ellipsize(list.compactMap(scalarString).joined(separator: " "), max)
            }
            if let scalar = scalarString(parsed) {
                return ellipsize(scalar, max)
            }
            // JSON `null` and anything else unrepresentable fall through to the
            // raw text below, which is what the web summariser does too.
        }

        // A payload that looks like an object but did not parse — a truncated
        // `{ "file_path": "src/foo…` blob. Pull the first identifying token.
        if raw.hasPrefix("{"), let token = firstIdentifyingToken(in: raw) {
            return ellipsize(token, max)
        }

        // Plain payload (a bare shell command line, a search string) — as-is.
        return ellipsize(raw, max)
    }

    // MARK: - Records

    private static func summarize(name: String, record: [String: Any], max: Int) -> String? {
        for key in keyOrder(for: name) {
            if let value = record[key], let scalar = scalarString(value) {
                return ellipsize(scalar, max)
            }
        }
        // No well-known key — fall back to the first scalar value. Swift
        // dictionaries are unordered where JS objects keep insertion order, so
        // sort for a stable answer rather than an arbitrary one.
        for key in record.keys.sorted() {
            if let value = record[key], let scalar = scalarString(value) {
                return ellipsize(scalar, max)
            }
        }
        // Nothing but containers (a `todos` array, a nested config). The web
        // summariser falls back to the JSON itself here; on a chip that is the
        // very brace-noise this type exists to remove, so say nothing and let
        // the tool name stand alone.
        return nil
    }

    // MARK: - Value helpers

    /// A JSON scalar rendered for display, or nil for blanks, containers and
    /// `null` — the values that would summarise to noise.
    private static func scalarString(_ value: Any) -> String? {
        if let text = value as? String {
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : text
        }
        guard let number = value as? NSNumber else { return nil }
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
        return number.stringValue
    }

    private static func parseJSON(_ raw: String) -> Any? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    /// A quoted token, or something that looks like a file path.
    private static let quotedToken = try? NSRegularExpression(
        pattern: "\"([^\"\\n]{2,})\"|'([^'\\n]{2,})'")
    private static let pathToken = try? NSRegularExpression(
        pattern: "(?:~|\\.{1,2})?/?[\\w.@-]+(?:/[\\w.@-]+)+")

    /// Pull the leading path-looking or quoted token out of an unparseable
    /// object-ish blob, preferring whichever appears first.
    ///
    /// Quoted tokens that a `:` follows are *keys*, and a key is the one thing
    /// the reader can already infer from the tool name — skip them so a
    /// truncated `{"file_path": "src/foo.ts…` summarises to the path rather
    /// than to the word "file_path".
    private static func firstIdentifyingToken(in raw: String) -> String? {
        let text = raw as NSString
        let range = NSRange(location: 0, length: text.length)

        var quoted: (value: String, location: Int)?
        for match in quotedToken?.matches(in: raw, range: range) ?? [] {
            guard !isKeyToken(match, in: text) else { continue }
            for group in 1...2 where match.range(at: group).location != NSNotFound {
                quoted = (text.substring(with: match.range(at: group)), match.range.location)
                break
            }
            if quoted != nil { break }
        }

        var path: (value: String, location: Int)?
        if let match = pathToken?.firstMatch(in: raw, range: range) {
            path = (text.substring(with: match.range), match.range.location)
        }

        guard let path else { return quoted?.value }
        guard let quoted else { return path.value }
        return path.location < quoted.location ? path.value : quoted.value
    }

    /// True when the next non-space character after a quoted token is a colon.
    private static func isKeyToken(_ match: NSTextCheckingResult, in text: NSString) -> Bool {
        var index = match.range.location + match.range.length
        while index < text.length {
            let character = text.character(at: index)
            if character == 32 || character == 9 { index += 1; continue } // space, tab
            return character == 58 // ':'
        }
        return false
    }

    /// Collapse to a single line and cap with an ellipsis. Nil when nothing
    /// survives the flattening.
    private static func ellipsize(_ value: String, _ max: Int) -> String? {
        let flat = value
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !flat.isEmpty, max > 0 else { return nil }
        guard flat.count > max else { return flat }
        return String(flat.prefix(max - 1)) + "…"
    }
}
