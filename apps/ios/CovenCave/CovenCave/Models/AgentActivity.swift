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
    /// mirror the server's statuses: `tool_use` sends running/ok/error, and
    /// `progress` sends running/done/notice/error ("done" maps to `ok`).
    /// `notice` is an informational line the harness reports — a compatibility
    /// warning, a rate-limit note — and is terminal on arrival, so it must not
    /// decode as `running` or it spins for the rest of the turn.
    enum Status: String, Codable {
        case requested, running, ok, error, rejected, notice, unknown

        var isActive: Bool { self == .requested || self == .running }
        var isKnownOutcome: Bool { self == .ok || self == .error || self == .rejected }

        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer().decode(String.self)
            self = Status(rawValue: value) ?? .unknown
        }
    }

    var id: String
    var kind: Kind
    /// Tool name ("Bash", "Edit") or progress label ("Thinking…").
    var title: String
    /// Short input/detail line — a command head, a file path. Capped at fold
    /// time; full projected output is loaded separately in a transient sheet.
    var detail: String?
    var status: Status = .running
    /// Wall-clock duration the server reported when the step settled.
    var durationMs: Int?
    /// Why a failed step failed — the tail of the tool's output, kept only for
    /// `.error` steps. Full results stay out of persisted activity snapshots;
    /// a failure preview remains readable without opening the detail sheet.
    var errorOutput: String?
    var activity: ToolActivity? = nil
    var textOffset: Int? = nil
}

extension ActivityStep {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        kind = try values.decode(Kind.self, forKey: .kind)
        title = try values.decode(String.self, forKey: .title)
        detail = try values.decodeIfPresent(String.self, forKey: .detail)
        status = try values.decodeIfPresent(Status.self, forKey: .status) ?? .unknown
        durationMs = try values.decodeIfPresent(Int.self, forKey: .durationMs)
        errorOutput = try values.decodeIfPresent(String.self, forKey: .errorOutput)
        activity = kind == .tool ? (try? values.decodeIfPresent(ToolActivity.self, forKey: .activity))?.validated(callId: id, status: status.rawValue) : nil
        if let offset = try? values.decode(Int.self, forKey: .textOffset), offset >= 0, offset <= 9_007_199_254_740_991 {
            textOffset = offset
        }
    }
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
    /// A failure reason gets a few wrapped lines — enough to read the error,
    /// far short of the payload the desktop shows.
    static let errorOutputCap = 300
    static let errorOutputLines = 4
    /// What `capLiveToolPayload` appends when it head-caps a live payload.
    private static let liveTruncationMarker = "[tool payload truncated]"

    /// Fold one event into `steps`. Returns the updated list, or nil when the
    /// event doesn't change the activity (callers skip the mutation + notify).
    static func fold(_ steps: [ActivityStep], event: StreamEvent, textOffset: Int? = nil) -> [ActivityStep]? {
        switch event {
        case .toolUse(let id, let name, let input, let output, let status, let durationMs, let activity):
            return foldTool(steps, id: id, name: name, input: input, output: output,
                            status: status, durationMs: durationMs, activity: activity, textOffset: textOffset)
        case .progress(let id, let label, let detail, let status, let durationMs):
            return foldProgress(steps, id: id, label: label, detail: detail,
                                status: status, durationMs: durationMs)
        default:
            return nil
        }
    }

    /// Settle every still-running step when the turn ends. The stream is the
    /// only writer, so a persisted "running" badge would spin forever after
    /// reload. Turn completion does not establish an unfinished tool's outcome.
    static func settle(_ steps: [ActivityStep], success: Bool) -> [ActivityStep]? {
        guard steps.contains(where: { $0.status.isActive }) else { return nil }
        return steps.map { step in
            guard step.status.isActive else { return step }
            var settled = step
            settled.status = step.kind == .tool ? .unknown : (success ? .ok : .error)
            settled.activity = nil
            return settled
        }
    }

    // MARK: - Folding rules

    /// `tool_use` arrives (at most) twice per call — start (`running`) and
    /// settle (`ok`/`error`) under the same id. A start appends; a settle
    /// updates its step in place. Events with no id can never be re-keyed,
    /// so they simply append.
    private static func foldTool(_ steps: [ActivityStep], id: String?, name: String,
                                 input: String?, output: String?, status: String?,
                                 durationMs: Int?, activity: ToolActivity?, textOffset: Int?) -> [ActivityStep]? {
        let parsedStatus = ActivityStep.Status(rawValue: status ?? "running") ?? .unknown
        // Only a failure earns its output a place in the trail. Intermediate
        // `running` frames carry partial output too, which would churn the
        // snapshot for a call that is about to succeed anyway.
        let failure = parsedStatus == .error ? capErrorOutput(output) : nil
        if let id, let idx = steps.lastIndex(where: { $0.kind == .tool && $0.id == id }) {
            var step = steps[idx]
            var changed = false
            // Replay may deliver the start after a result. Keep the first
            // known outcome; a later result can resolve an unknown outcome.
            let knownOutcome = step.status.isKnownOutcome
            let staleStart = (step.status == .unknown && parsedStatus.isActive)
                || (step.status == .running && parsedStatus == .requested)
            if !knownOutcome && !staleStart && step.status != parsedStatus {
                step.status = parsedStatus
                changed = true
            }
            if step.detail == nil, let detail = argSummary(name: name, input: input) {
                step.detail = detail
                changed = true
            }
            if !knownOutcome, !staleStart, step.status == .error, let failure, step.errorOutput != failure {
                step.errorOutput = failure
                changed = true
            }
            if !knownOutcome, !staleStart, let durationMs, step.durationMs != durationMs {
                step.durationMs = durationMs
                changed = true
            }
            if !knownOutcome, !staleStart {
                let observation = activity?.validated(callId: step.id, status: step.status.rawValue)
                if step.activity != observation { step.activity = observation; changed = true }
            }
            guard changed else { return nil }
            var updated = steps
            updated[idx] = step
            return updated
        }
        let step = ActivityStep(id: id ?? UUID().uuidString, kind: .tool, title: name,
                                detail: argSummary(name: name, input: input),
                                status: parsedStatus, durationMs: durationMs,
                                errorOutput: failure,
                                activity: id.flatMap { activity?.validated(callId: $0, status: parsedStatus.rawValue) },
                                textOffset: textOffset)
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

    /// Progress details are already prose — one line, capped.
    private static func cap(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        // One line only — a multi-line detail reads as noise in a chip.
        let firstLine = trimmed.split(separator: "\n", maxSplits: 1,
                                      omittingEmptySubsequences: false)[0]
        return String(firstLine.prefix(detailCap))
    }

    /// Why a failed call failed, trimmed to fit under a step row.
    ///
    /// Keeps the **tail**: a failing build prints its error last, which is the
    /// same reason the server tail-caps persisted output. Live output is capped
    /// the other way — head-first, with a `[tool payload truncated]` marker
    /// glued on the end — so drop that marker before taking the tail, or every
    /// long failure would report the marker instead of the error.
    private static func capErrorOutput(_ text: String?) -> String? {
        guard var trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        if trimmed.hasSuffix(liveTruncationMarker) {
            trimmed = String(trimmed.dropLast(liveTruncationMarker.count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        let tail = lines.suffix(errorOutputLines).joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tail.isEmpty else { return nil }
        guard tail.count > errorOutputCap else { return tail }
        return "…" + String(tail.suffix(errorOutputCap - 1))
    }

    /// Tool inputs are pretty-printed JSON, whose first line is a bare `{`.
    /// Summarise the payload down to its most identifying argument instead —
    /// the same one-liner the web chat shows beside a tool name.
    private static func argSummary(name: String, input: String?) -> String? {
        ToolArgSummary.summary(name: name, input: input, max: detailCap)
    }

    /// Map a persisted conversation turn's tool calls into activity steps so
    /// history loads keep the trail. Missing or unrecognized outcomes remain
    /// unknown; persistence is not proof of successful execution.
    static func steps(fromTools tools: [ToolCall]?) -> [ActivityStep]? {
        guard let tools, !tools.isEmpty else { return nil }
        return tools.suffix(maxSteps).map { tool in
            let failed = tool.status == "error"
            let observed = ActivityStep.Status(rawValue: tool.status ?? "") ?? .unknown
            let status: ActivityStep.Status = observed.isKnownOutcome ? observed : .unknown
            return ActivityStep(id: tool.id, kind: .tool, title: tool.name,
                                detail: argSummary(name: tool.name, input: tool.input),
                                status: status,
                                durationMs: tool.durationMs,
                                errorOutput: failed ? capErrorOutput(tool.output) : nil,
                                activity: tool.activity?.validated(callId: tool.id, status: status.rawValue),
                                textOffset: tool.textOffset)
        }
    }
}

extension Array where Element == ActivityStep {
    /// The step a live chip should narrate: the newest still-running one,
    /// falling back to the newest overall while the server settles.
    var currentStep: ActivityStep? {
        last(where: { $0.status.isActive }) ?? last
    }

    /// Count observed calls without asserting that every request executed.
    var summaryLabel: String {
        let tools = filter { $0.kind == .tool }
        let failed = filter { $0.status == .error }.count
        let unknown = tools.filter { $0.status == .unknown }.count
        let requested = tools.filter { $0.status == .requested }.count
        let rejected = tools.filter { $0.status == .rejected }.count
        var label: String
        if tools.isEmpty {
            label = count == 1 ? "1 step" : "\(count) steps"
        } else {
            label = tools.count == 1 ? "1 tool call" : "\(tools.count) tool calls"
        }
        if failed > 0 { label += " · \(failed) failed" }
        if unknown > 0 { label += " · \(unknown) outcome unknown" }
        if requested > 0 { label += " · \(requested) requested" }
        if rejected > 0 { label += " · \(rejected) rejected" }
        return label
    }
}
