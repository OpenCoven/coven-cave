// Pure project status derivation for the Projects tab dot. Self-contained (no
// React, no fs) so it can be unit-tested in isolation; type-only import keeps it
// safe under the strip-types test runner.

import type { SessionRow } from "./types.ts";

/** A project counts as "recently active" if its newest session moved within this window. */
export const RECENT_ACTIVE_MS = 24 * 60 * 60 * 1000;

/**
 * Glanceable status for a project's dot, in precedence order:
 *   running  — any session running
 *   failed   — the most-recent session failed/errored
 *   recent   — newest activity within RECENT_ACTIVE_MS (idle but fresh)
 *   null     — dormant (no dot)
 */
export function deriveProjectStatus(
  chats: SessionRow[],
  now: number = Date.now(),
): "running" | "failed" | "recent" | null {
  if (chats.some((s) => s.status === "running")) return "running";

  let max = 0;
  let mostRecent: SessionRow | null = null;
  for (const s of chats) {
    const t = new Date(s.updated_at).getTime();
    if (Number.isFinite(t) && t > max) {
      max = t;
      mostRecent = s;
    }
  }
  if (mostRecent && (mostRecent.status === "failed" || mostRecent.status === "error")) return "failed";
  if (max > 0 && now - max <= RECENT_ACTIVE_MS) return "recent";
  return null;
}
