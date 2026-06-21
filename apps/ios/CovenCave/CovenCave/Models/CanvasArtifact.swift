import Foundation

/// How an artifact's `code` should be previewed. A `react` artifact is a single
/// default-exported component transpiled by the offline sandbox runtime; an
/// `html` artifact is a self-contained document. Absent on older records ⇒ html.
enum ArtifactKind: String, Codable {
    case html
    case react

    var label: String { self == .react ? "React" : "HTML" }
    var symbol: String { self == .react ? "atom" : "chevron.left.forwardslash.chevron.right" }
}

/// One Canvas artifact — a generated, self-contained UI document. Mirrors the
/// web record persisted at `~/.coven/cave-canvas.json` via `/api/canvas`, so the
/// JSON shape (and `kind` back-compat) matches the desktop exactly.
struct CanvasArtifact: Identifiable, Codable, Hashable {
    var id: String
    /// Short human label, derived from the prompt.
    var title: String
    /// The natural-language description the user asked for.
    var prompt: String
    /// The HTML document or React component source rendered in the preview.
    var code: String
    /// How `code` previews. Absent in JSON ⇒ `.html` (back-compat).
    var kind: ArtifactKind
    /// ISO-8601 timestamps, kept as strings to round-trip the server record.
    var createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, prompt, code, kind, createdAt, updatedAt
    }

    init(id: String, title: String, prompt: String, code: String,
         kind: ArtifactKind, createdAt: String, updatedAt: String) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.code = code
        self.kind = kind
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        prompt = (try? c.decode(String.self, forKey: .prompt)) ?? ""
        code = (try? c.decode(String.self, forKey: .code)) ?? ""
        kind = (try? c.decode(ArtifactKind.self, forKey: .kind)) ?? .html
        let decodedTitle = (try? c.decode(String.self, forKey: .title)) ?? ""
        title = decodedTitle.isEmpty ? CanvasArtifact.titleFromPrompt(prompt) : decodedTitle
        let created = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
        createdAt = created
        updatedAt = (try? c.decode(String.self, forKey: .updatedAt)) ?? created
    }

    /// Best-effort parse of `updatedAt` for relative-time display.
    var updatedDate: Date? { CanvasArtifact.isoFormatter.date(from: updatedAt) }

    /// The framed document fed to a `WKWebView` preview (HTML or React).
    var previewSrcDoc: String {
        kind == .react ? CanvasArtifact.buildReactSrcDoc(code)
                       : CanvasArtifact.buildPreviewSrcDoc(code)
    }

    // MARK: - Timestamps

    static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func nowISO() -> String { isoFormatter.string(from: Date()) }
}

// MARK: - Pure helpers (port of src/lib/canvas-artifacts.ts + canvas-react-harness.ts)

extension CanvasArtifact {
    static let maxCodeChars = 200_000
    private static let maxTitleChars = 60

    /// A compact title from a prompt: first non-empty line, collapsed, clamped.
    static func titleFromPrompt(_ prompt: String) -> String {
        let firstLine = prompt
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first(where: { !$0.isEmpty }) ?? "Untitled"
        let collapsed = firstLine.replacingOccurrences(
            of: "\\s+", with: " ", options: .regularExpression
        ).trimmingCharacters(in: .whitespaces)
        if collapsed.isEmpty { return "Untitled" }
        if collapsed.count <= maxTitleChars { return collapsed }
        return String(collapsed.prefix(maxTitleChars - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Clamp code to the storage cap, preserving the head of the document.
    static func clampCode(_ code: String) -> String {
        code.count > maxCodeChars ? String(code.prefix(maxCodeChars)) : code
    }

    /// True when `code` already looks like a full HTML document (vs a fragment).
    static func isFullDocument(_ code: String) -> Bool {
        matches(code, #"<html[\s>]"#) || matches(code, #"<!doctype html"#)
    }

    /// A single renderable artifact pulled from a familiar's chat response.
    struct Extracted { let kind: ArtifactKind; let code: String }

    /// Pull a renderable artifact out of a familiar's response and classify it.
    /// A `tsx`/`jsx` fence ⇒ React; an `html` fence (or bare `<!doctype>`) ⇒
    /// HTML; an untagged fence is classified by content. Nil ⇒ nothing renders.
    static func extractArtifact(_ text: String) -> Extracted? {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }

        let fences = fencedBlocks(text)
        if !fences.isEmpty {
            if let react = fences.first(where: { isReactLang($0.lang) && !$0.code.isEmpty }) {
                return Extracted(kind: .react, code: react.code)
            }
            if let html = fences.first(where: { isHtmlLang($0.lang) && !$0.code.isEmpty }) {
                return Extracted(kind: .html, code: html.code)
            }
            let first = fences[0].code
            if !first.isEmpty {
                return Extracted(kind: looksLikeReact(first) ? .react : .html, code: first)
            }
        }

        if let doc = bareDocument(text) { return Extracted(kind: .html, code: doc) }
        return nil
    }

    // MARK: Preview framing

    /// Frame artifact HTML for the preview. Full documents pass through; a bare
    /// fragment is wrapped in a minimal document with neutral base styling.
    static func buildPreviewSrcDoc(_ code: String) -> String {
        if isFullDocument(code) { return code }
        return """
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root { color-scheme: light dark; }
          body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }
        </style>
        </head>
        <body>\(code)</body>
        </html>
        """
    }

    /// Absolute paths to the offline sandbox runtime, resolved against the
    /// preview's base URL (the Cave server) — same assets the desktop uses.
    static let sandboxRuntimeSrc = "/sandbox/react-runtime.js"
    static let sandboxTailwindSrc = "/sandbox/tailwind.js"

    /// Neutralize `</script>` so component source can't break out of the tag.
    static func escapeForScriptTag(_ code: String) -> String {
        code.replacingOccurrences(
            of: "</(script>)", with: "<\\/$1",
            options: [.regularExpression, .caseInsensitive]
        )
    }

    /// Frame React component source into a full preview document. Requires the
    /// preview WKWebView's base URL to be the Cave server so `/sandbox/*` loads.
    static func buildReactSrcDoc(_ code: String) -> String {
        """
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root { color-scheme: light dark; }
          body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
        </style>
        <script src="\(sandboxTailwindSrc)"></script>
        </head>
        <body>
        <div id="root"></div>
        <script type="text/jsx">\(escapeForScriptTag(code))</script>
        <script src="\(sandboxRuntimeSrc)"></script>
        </body>
        </html>
        """
    }

    // MARK: Prompts

    /// The instruction wrapped around the user's description before it goes to
    /// the familiar — constrains output to one self-contained document.
    static func buildSketchPrompt(_ userPrompt: String) -> String {
        let ask = userPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = ask.isEmpty ? "a simple example UI" : ask
        return """
        You are generating a UI for a live preview sandbox inside a design canvas.

        Output EXACTLY ONE fenced code block and nothing else — no prose before or after.
        Choose ONE of these two forms:

        (A) A ```html block: a COMPLETE self-contained document starting with `<!doctype html>`,
            with all CSS inlined in <style> and all JS inlined in <script>. No external files.

        (B) A ```tsx block: a single React component, DEFAULT-EXPORTED and named `App`
            (e.g. `export default function App() { … }`). React 19 and its hooks are available
            as globals — use `React.useState`, or destructure `const { useState } = React`.
            Do NOT write `import React`/`import ReactDOM` and do NOT load anything from a CDN.
            Tailwind utility classes ARE available — style with `className="…"` (e.g. `flex gap-4 rounded-xl`)
            and/or inline `style={{…}}`. Both work.

        Prefer (B) tsx for interactive components; (A) html for static pages or plain markup.
        It must render on its own with no network access. Make it polished and responsive.

        Build this: \(body)
        """
    }

    /// Prompt for iterating on an existing artifact: hand the familiar the
    /// current document plus the change request, same one-document contract.
    static func buildRefinePrompt(currentCode: String, changeRequest: String,
                                  kind: ArtifactKind) -> String {
        let ask = changeRequest.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = ask.isEmpty ? "improve it" : ask
        let lang = kind == .react ? "tsx" : "html"
        let noun = kind == .react ? "React component" : "document"
        return """
        \(buildSketchPrompt("Apply this change: \(request)"))

        Modify the \(noun) below. Keep the same \(lang) form and return the FULL updated \(noun), not a diff:

        ```\(lang)
        \(currentCode.trimmingCharacters(in: .whitespacesAndNewlines))
        ```
        """
    }

    // MARK: - Private regex helpers

    private struct Fence { let lang: String; let code: String }

    private static func isReactLang(_ lang: String) -> Bool {
        ["tsx", "jsx", "react", "javascriptreact", "typescriptreact"].contains(lang.lowercased())
    }

    private static func isHtmlLang(_ lang: String) -> Bool {
        ["html", "htm", "markup", "xml"].contains(lang.lowercased())
    }

    private static func looksLikeReact(_ code: String) -> Bool {
        if matches(code, #"<!doctype html"#) || matches(code, #"<html[\s>]"#) { return false }
        return matches(code, #"\bexport\s+default\b"#)
            || matches(code, #"\bfunction\s+App\b"#)
            || matches(code, #"\buse(State|Effect|Ref|Memo|Callback)\b"#)
    }

    /// All fenced ```lang\n…``` blocks, in source order, trimmed.
    private static func fencedBlocks(_ text: String) -> [Fence] {
        let pattern = "```([\\w-]*)\\n([\\s\\S]*?)```"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            let lang = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
            let code = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
            return Fence(lang: lang, code: code)
        }
    }

    /// First bare `<!doctype html>…</html>` (or `<html>…</html>`) span, if any.
    private static func bareDocument(_ text: String) -> String? {
        for pattern in [#"<!doctype html[\s\S]*</html>"#, #"<html[\s\S]*</html>"#] {
            if let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let ns = text as NSString
                if let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) {
                    return ns.substring(with: m.range).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
        return nil
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return false
        }
        let ns = text as NSString
        return re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) != nil
    }
}
