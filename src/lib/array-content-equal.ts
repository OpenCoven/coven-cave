// True when two arrays are content-identical (same length, same order, same
// per-element value by structural JSON compare). Polls that rebuild a fresh
// array each tick (e.g. /api/board → openTaskCards / boardDeadlines) use this to
// return the previous reference from a state updater, so an unchanged result
// doesn't re-render every consumer for nothing.
//
// Intended for small, JSON-serializable arrays (badge/deadline lists). Elements
// are built by one code path so key order is stable.
export function arrayContentEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}
