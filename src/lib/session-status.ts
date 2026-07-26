// cave-32ks phase 2: one mapping from a daemon SessionRow.status string to
// the status-dot + word pattern (design language §3), shared by the card
// chips on the board (kanban tile + inspector drawer). Familiar-level
// presence lives in presence.ts; this is the per-session cut of the same
// vocabulary. Pure so it pins/tests without a DOM.

export type SessionStatusTone = "running" | "done" | "failed" | "idle";

const RUNNING = new Set(["running", "starting", "working"]);
const DONE = new Set(["completed", "complete", "done"]);
const FAILED = new Set(["failed", "error", "killed", "orphaned"]);

export function sessionStatusTone(status: string | null | undefined): SessionStatusTone {
  const s = (status ?? "").toLowerCase();
  if (RUNNING.has(s)) return "running";
  if (DONE.has(s)) return "done";
  if (FAILED.has(s)) return "failed";
  return "idle";
}

/** The word the dot pairs with — always lowercase, one word. */
export function sessionStatusWord(status: string | null | undefined): string {
  return sessionStatusTone(status);
}
