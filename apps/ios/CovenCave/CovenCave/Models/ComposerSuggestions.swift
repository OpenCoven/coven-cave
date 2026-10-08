import Foundation

/// A skill the composer can invoke (`GET /api/skills/local`, #5876). Only the
/// fields the picker and the invocation need; the desktop's fuller row is a
/// superset, and unknown keys are ignored.
struct SkillOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    var description: String?
    /// SKILL.md `argument-hint` (e.g. `[pr-number]`). A hinted skill fills in
    /// `/skill <id> ` for argument editing instead of sending on pick.
    var argumentHint: String?
}

/// A prompt template the composer can insert (`GET /api/prompts`, #5876).
struct PromptOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    var description: String?
    var tags: [String]?
    /// The template text dropped into the composer. May carry `{{placeholder}}`s.
    let body: String
}

struct SkillsResponse: Decodable { let skills: [SkillOption] }
struct PromptsResponse: Decodable { let prompts: [PromptOption] }

/// The desktop's `/skill` rules (src/lib/slash-skill.ts), ported so the phone
/// resolves and phrases a skill exactly as the desktop does.
enum SkillInvocation {
    /// One row per id, first wins: the scan roots overlap, so raw lists repeat.
    static func dedupe(_ skills: [SkillOption]) -> [SkillOption] {
        var seen = Set<String>()
        return skills.filter { seen.insert($0.id).inserted }
    }

    static func filter(_ skills: [SkillOption], partial: String) -> [SkillOption] {
        let q = partial.trimmingCharacters(in: .whitespaces).lowercased()
        let unique = dedupe(skills)
        guard !q.isEmpty else { return unique }
        return unique.filter {
            $0.id.lowercased().contains(q) || $0.name.lowercased().contains(q)
                || ($0.description?.lowercased().contains(q) ?? false)
        }
    }

    /// Exact id or name first, then a substring of either.
    static func resolve(_ arg: String, in skills: [SkillOption]) -> SkillOption? {
        let a = arg.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !a.isEmpty else { return nil }
        if let exact = skills.first(where: { $0.id.lowercased() == a || $0.name.lowercased() == a }) {
            return exact
        }
        return skills.first { $0.id.lowercased().contains(a) || $0.name.lowercased().contains(a) }
    }

    /// The whole argument as a name first (multi-word names keep working),
    /// then the first whitespace-separated token as the name and the rest as
    /// the skill's arguments.
    static func resolveInvocation(_ arg: String, in skills: [SkillOption]) -> (skill: SkillOption, args: String)? {
        if let whole = resolve(arg, in: skills) { return (whole, "") }
        let t = arg.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let split = t.firstIndex(where: { $0.isWhitespace }), split > t.startIndex else { return nil }
        guard let skill = resolve(String(t[..<split]), in: skills) else { return nil }
        return (skill, String(t[split...]).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// The message sent to the familiar. The harness owns skill execution, so
    /// this is a plain directive; a single-line argument rides after it, and
    /// anything spanning lines or already written is carried as the body.
    static func prompt(for skill: SkillOption, args: String = "", message: String = "") -> String {
        let a = args.trimmingCharacters(in: .whitespacesAndNewlines)
        let inline = a.contains("\n") ? "" : a
        let head = inline.isEmpty
            ? "Use the \"\(skill.name)\" skill."
            : "Use the \"\(skill.name)\" skill with: \(inline)"
        let body = [inline.isEmpty ? a : "", message.trimmingCharacters(in: .whitespacesAndNewlines)]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
        return body.isEmpty ? head : "\(head)\n\n\(body)"
    }
}

/// The desktop's `/prompt` rules (src/lib/slash-prompt.ts). Picking a prompt
/// inserts its body for editing; it never sends.
enum PromptPick {
    static func filter(_ prompts: [PromptOption], partial: String) -> [PromptOption] {
        let q = partial.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return prompts }
        return prompts.filter {
            $0.id.lowercased().contains(q) || $0.name.lowercased().contains(q)
                || ($0.description?.lowercased().contains(q) ?? false)
                || ($0.tags?.contains { $0.lowercased().contains(q) } ?? false)
        }
    }

    static func resolve(_ arg: String, in prompts: [PromptOption]) -> PromptOption? {
        let a = arg.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !a.isEmpty else { return nil }
        if let exact = prompts.first(where: { $0.id.lowercased() == a || $0.name.lowercased() == a }) {
            return exact
        }
        return prompts.first { $0.id.lowercased().contains(a) || $0.name.lowercased().contains(a) }
    }
}
