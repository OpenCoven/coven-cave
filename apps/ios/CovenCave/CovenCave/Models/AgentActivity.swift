import Foundation

/// One agent working step surfaced by the chat stream while a reply runs —
/// a tool call (`tool_use`) or a harness progress line (`progress`). Persisted
/// with the message so a finished turn keeps a compact trail of what the
/// familiar actually did.
struct ActivityStep: Codable, Hashable, Identifiable {
    enum Kind: String, Codable {
        case tool, progress
    }

    /// `running` animates; terminal states render a settled glyph. Raw values
    /// mirror the server's `tool_use` statuses (`progress` "done" maps to `ok`).
    enum Status: String, Codable {
        case running, ok, error
    }

    var id: String
    var kind: Kind
    /// Tool name ("Bash", "Edit") or progress label ("Thinking…").
    var title: String
    /// Short input/detail line — a command head, a file path. Capped at fold
    /// time; chips are tiny, payloads stay on the desktop.
    var detail: String?
    var status: Status = .running
    /// Wall-clock duration the server reported when the step settled.
    var durationMs: Int?
}

/// Folds raw stream events into a message's activity list. Pure functions so
/// the stream handler stays trivial and replay stays testable: updates are
/// keyed by the server's tool id, which makes re-applying an already-seen
/// frame (mid-turn resume replays past the cursor) a harmless no-op.
enum ActivityFold {
    /// Bound per message so a runaway turn can't grow snapshots without limit.
    /// The oldest steps drop first — the tail is where the action is.
    static let maxSteps = 120
    /// Detail strings are one-line chips, never payloads.
    static let detailCap = 140

    /// Fold one event into `steps`. Returns the updated list, or nil when the
    /// event doesn't change the activity (callers skip the mutation + notify).
    static func fold(_ steps: [ActivityStep], event: StreamEvent) -> [ActivityStep]? {
        switch event {
        case .toolUse(let id, let name, let input, _, let status, let durationMs):
            return foldTool(steps, id: id, name: name, input: input,
                            status: status, durationMs: durationMs)
        case .progress(let id, let label, let detail, let status, let durationMs):
            return foldProgress(steps, id: id, label: label, detail: detail,
                                status: status, durationMs: durationMs)
        default:
            return nil
        }
    }

    /// Settle every still-running step when the turn ends. The stream is the
    /// only writer, so a persisted "running" badge would spin forever after
    /// reload — successful turns settle to `ok`, failed ones to `error`.
    static func settle(_ steps: [ActivityStep], success: Bool) -> [ActivityStep]? {
        guard steps.contains(where: { $0.status == .running }) else { return nil }
        return steps.map { step in
            guard step.status == .running else { return step }
            var settled = step
            settled.status = success ? .ok : .error
            return settled
        }
    }

    // MARK: - Folding rules

    /// `tool_use` arrives (at most) twice per call — start (`running`) and
    /// settle (`ok`/`error`) under the same id. A start appends; a settle
    /// updates its step in place. Events with no id can never be re-keyed,
    /// so they simply append.
    private static func foldTool(_ steps: [ActivityStep], id: String?, name: String,
                                 input: String?, status: String?,
                                 durationMs: Int?) -> [ActivityStep]? {
        let parsedStatus = ActivityStep.Status(rawValue: status ?? "") ?? .running
        if let id, let idx = steps.lastIndex(where: { $0.kind == .tool && $0.id == id }) {
            var step = steps[idx]
            var changed = false
            if step.status != parsedStatus { step.status = parsedStatus; changed = true }
            if step.detail == nil, let detail = cap(input) { step.detail = detail; changed = true }
            if let durationMs, step.durationMs != durationMs {
                step.durationMs = durationMs
                changed = true
            }
            guard changed else { return nil }
            var updated = steps
            updated[idx] = step
            return updated
        }
        let step = ActivityStep(id: id ?? UUID().uuidString, kind: .tool, title: name,
                                detail: cap(input), status: parsedStatus,
                                durationMs: durationMs)
        return append(step, to: steps)
    }

    /// Progress lines are transient status ("Thinking…", "Compacting…"). A
    /// repeat of the latest label updates that step in place — harnesses
    /// re-emit the same line as it advances — while a new label appends.
    private static func foldProgress(_ steps: [ActivityStep], id: String?, label: String,
                                     detail: String?, status: String?,
                                     durationMs: Int?) -> [ActivityStep]? {
        guard !label.isEmpty else { return nil }
        let parsedStatus: ActivityStep.Status =
            status == "done" ? .ok : ActivityStep.Status(rawValue: status ?? "") ?? .running
        let matchesLast = steps.last.map { last in
            last.kind == .progress && (id.map { $0 == last.id } ?? (last.title == label))
        } ?? false
        if matchesLast, let last = steps.last {
            var step = last
            var changed = false
            if step.status != parsedStatus { step.status = parsedStatus; changed = true }
            if let detail = cap(detail), step.detail != detail { step.detail = detail; changed = true }
            if let durationMs, step.durationMs != durationMs {
                step.durationMs = durationMs
                changed = true
            }
            guard changed else { return nil }
            var updated = steps
            updated[updated.count - 1] = step
            return updated
        }
        let step = ActivityStep(id: id ?? UUID().uuidString, kind: .progress, title: label,
                                detail: cap(detail), status: parsedStatus,
                                durationMs: durationMs)
        return append(step, to: steps)
    }

    private static func append(_ step: ActivityStep, to steps: [ActivityStep]) -> [ActivityStep] {
        var updated = steps
        updated.append(step)
        if updated.count > maxSteps {
            updated.removeFirst(updated.count - maxSteps)
        }
        return updated
    }

    private static func cap(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        // One line only — a multi-line tool input reads as noise in a chip.
        let firstLine = trimmed.split(separator: "\n", maxSplits: 1,
                                      omittingEmptySubsequences: false)[0]
        return String(firstLine.prefix(detailCap))
    }

    /// Map a persisted conversation turn's tool calls into activity steps so
    /// history loads keep the trail. Persisted calls are settled by
    /// definition — anything not marked "error" reads as ok, never running.
    static func steps(fromTools tools: [ToolCall]?) -> [ActivityStep]? {
        guard let tools, !tools.isEmpty else { return nil }
        return tools.suffix(maxSteps).map { tool in
            ActivityStep(id: tool.id, kind: .tool, title: tool.name,
                         detail: cap(tool.input),
                         status: tool.status == "error" ? .error : .ok)
        }
    }
}

extension Array where Element == ActivityStep {
    /// The step a live chip should narrate: the newest still-running one,
    /// falling back to the newest overall while the server settles.
    var currentStep: ActivityStep? {
        last(where: { $0.status == .running }) ?? last
    }

    /// Collapsed one-line summary for a finished turn — "Ran 4 tools",
    /// "Ran 1 tool · 1 failed", or "4 steps" for progress-only turns.
    var summaryLabel: String {
        let tools = filter { $0.kind == .tool }
        let failed = filter { $0.status == .error }.count
        var label: String
        if tools.isEmpty {
            label = count == 1 ? "1 step" : "\(count) steps"
        } else {
            label = tools.count == 1 ? "Ran 1 tool" : "Ran \(tools.count) tools"
        }
        if failed > 0 { label += " · \(failed) failed" }
        return label
    }
}
