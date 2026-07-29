// Pure model for the new-session launcher's Queue group (Chat.dc.html 2b).
//
// "Parked follow-ups" are ready beads — unblocked work that was deferred
// rather than dropped. They are the third place work already lives in the
// Cave, after the board (Tasks) and resumable threads (Chats).
//
// Kept free of React and of clock/formatting concerns so the rows can be
// pinned exactly: the surfaces format the age with their own helper, and the
// model only decides WHICH beads are parked and in what order.

import type { ReadyBead } from "./beads-work-queue.ts";

export type QueueFollowUp = {
  id: string;
  title: string;
  /** Lower sorts first, matching `bd`'s priority convention. */
  priority: number;
  /** ISO timestamp the surfaces turn into the row's compact age badge. */
  updatedAt: string | null;
  /** Familiar id / assignee the bead is parked under, or null when unclaimed. */
  owner: string | null;
};

/** Statuses that mean the work is already moving or finished — a follow-up is
 *  only "parked" while nobody has picked it up. */
const ACTIVE_STATUSES = new Set(["in_progress", "in-progress", "closed", "done", "merged"]);

/** The familiar a bead belongs to: an explicit `familiar:<id>` label wins,
 *  else the assignee. Mirrors familiarOf() in beads-work-queue.ts — the queue
 *  surface and this launcher must agree about ownership. */
export function beadOwner(bead: ReadyBead): string | null {
  for (const label of bead.labels ?? []) {
    if (label.startsWith("familiar:")) return label.slice("familiar:".length).toLowerCase() || null;
  }
  const assignee = bead.assignee?.trim().toLowerCase();
  return assignee || null;
}

/** Parked follow-ups for one familiar, most urgent first.
 *
 *  Ownership follows the starting page's existing rule for task pills:
 *  unassigned work is fair game (starting it routes the work to THIS
 *  familiar), another familiar's work is not — offering it here would
 *  misroute it. */
export function parkedFollowUps(
  beads: readonly ReadyBead[],
  opts: { familiarId?: string | null; cap?: number },
): QueueFollowUp[] {
  const familiarId = opts.familiarId?.trim().toLowerCase() || null;
  const rows = beads
    .filter((bead) => !ACTIVE_STATUSES.has((bead.status ?? "").trim().toLowerCase()))
    .filter((bead) => {
      const owner = beadOwner(bead);
      if (!owner || owner === "unassigned") return true;
      return familiarId ? owner === familiarId : false;
    })
    .map((bead) => ({
      id: bead.id,
      title: bead.title?.trim() || bead.id,
      priority: Number.isFinite(bead.priority) ? bead.priority : 9,
      updatedAt: bead.updated_at ?? null,
      owner: beadOwner(bead),
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const at = a.updatedAt ?? "";
      const bt = b.updatedAt ?? "";
      if (at === bt) return a.id.localeCompare(b.id);
      return at < bt ? 1 : -1;
    });
  const cap = opts.cap;
  return cap != null && cap >= 0 ? rows.slice(0, cap) : rows;
}

/** Accessible name for a follow-up row — the id and the parked state are part
 *  of the meaning, not decoration, so they belong in the label too. */
export function queueFollowUpLabel(row: QueueFollowUp): string {
  return `Start '${row.title}' — ${row.id}, queued`;
}
