import Foundation

/// One NDJSON event from `POST /api/board/enrich-steps` (#5652).
///
/// The server sweeps every open task, each through its own assigned familiar,
/// and streams one line per step: `start{total}`, `progress{cardId,title}`,
/// `done{cardId,count,closed}`, `skip{cardId,reason}`, `orchestration`, and a
/// final `complete`. Unknown kinds decode fine and are ignored by the tally.
struct EnhanceTasksEvent: Decodable, Equatable {
    let kind: String
    var total: Int?
    var cardId: String?
    var title: String?
    var closed: Bool?
    var reason: String?
}

/// Running outcome of one Enhance run. Mirrors the web app's
/// `src/lib/enrich-tasks-summary.ts`, so both apps say the same thing: every
/// task the run considered is updated, closed, unassigned, or skipped.
struct EnhanceTasksTally: Equatable {
    var total = 0
    var updated = 0
    var closed = 0
    var unassigned = 0
    var skipped = 0
    var completed = false

    /// Tasks the run has finished with, for "3 of 120" progress.
    var reached: Int { updated + unassigned + skipped }

    mutating func apply(_ event: EnhanceTasksEvent) {
        switch event.kind {
        case "start":
            total = event.total ?? 0
        case "done":
            updated += 1
            if event.closed == true { closed += 1 }
        case "skip":
            if event.reason == "unassigned" { unassigned += 1 } else { skipped += 1 }
        case "complete":
            completed = true
        default:
            break
        }
    }

    /// The closing toast line. The web app adds "Open Tasks to review."; the
    /// phone shows this on the Tasks screen itself, which reloads in place.
    var summary: String {
        if total == 0 { return "No open tasks to enhance right now." }
        var parts: [String] = []
        if updated > 0 {
            parts.append(closed > 0 ? "\(updated) updated (\(closed) closed)" : "\(updated) updated")
        }
        if unassigned > 0 { parts.append("\(unassigned) unassigned") }
        if skipped > 0 { parts.append("\(skipped) skipped") }
        if reached < total { parts.append("\(total - reached) not reached") }
        let noun = total == 1 ? "open task" : "open tasks"
        return "Reviewed \(total) \(noun): \(parts.joined(separator: ", "))."
    }
}
