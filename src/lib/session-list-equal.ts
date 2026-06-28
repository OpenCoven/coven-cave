import type { SessionRow } from "@/lib/types";

// True when two session lists are content-identical (same rows, same order,
// same field values). The /api/sessions/list poll rebuilds a fresh array every
// few seconds; feeding an equal-but-new array to setState re-renders the whole
// sessions tree for nothing. Callers use this to return the previous reference
// from the state updater so React bails out of the no-op render.
//
// Comparison is a per-row JSON.stringify: rows are built by one code path so key
// order is stable, and the lists are short (a user's session count), so this is
// cheap to run on every poll.
export function sameSessionList(a: readonly SessionRow[], b: readonly SessionRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}
