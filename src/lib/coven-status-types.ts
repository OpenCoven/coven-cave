// Pure types for Coven Floor — the familiar status board.
// Split from server code so client components can import without pulling
// in node:fs. Same pattern as coven-calls-types.ts.

/**
 * Derived familiar-level status. Roll-up rules:
 *   active  — any session with status "running" in the last 24 h
 *   stuck   — any session with status "failed" or "timeout" in the last
 *             6 h, and no "running" session supersedes it
 *   idle    — all sessions done/completed, most recent activity < 6 h ago
 *   quiet   — no session activity in the last 6 h
 */
export type FamiliarStatus = "active" | "stuck" | "idle" | "quiet";

export type SessionSummary = {
  id: string;
  /** Human label or title. Prefer taskName > label > title. */
  label: string;
  /** Raw daemon/openclaw status string. */
  status: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Runtime in ms, if known. */
  runtimeMs?: number;
  /** True if this is a spawned subagent. */
  isSubagent: boolean;
  /** Parent session id for subagents. */
  parentId?: string;
  /** Model used. */
  model?: string;
  /** Channel the session is on. */
  channel?: string;
};

export type FamiliarCard = {
  id: string;
  displayName: string;
  role: string;
  /** Emoji or Phosphor icon name, e.g. "🐾" or "ph:cat-fill". */
  glyph: string;
  /** Derived roll-up status. */
  status: FamiliarStatus;
  /** ISO timestamp of most recent session activity. */
  lastActiveAt: string | null;
  /** Label/task of the most recent or currently-running session. */
  currentTask: string | null;
  /** All recent sessions (last 24 h), newest first. */
  sessions: SessionSummary[];
  /** Count of currently running sessions (including subagents). */
  runningCount: number;
  /** Count of sessions in failed/timeout state in the last 6 h. */
  stuckCount: number;
};

/** What the /api/coven-status endpoint returns. */
export type CovenStatusResponse = {
  ok: true;
  familiars: FamiliarCard[];
  /** ISO timestamp of when this snapshot was computed. */
  computedAt: string;
};

// ── Status rollup helper ──────────────────────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function deriveStatus(sessions: SessionSummary[], now: number): FamiliarStatus {
  const recent24 = sessions.filter(
    (s) => now - new Date(s.updatedAt).getTime() < TWENTY_FOUR_HOURS_MS,
  );

  const running = recent24.some((s) => s.status === "running");
  if (running) return "active";

  const recent6 = recent24.filter(
    (s) => now - new Date(s.updatedAt).getTime() < SIX_HOURS_MS,
  );
  const stuck = recent6.some((s) => s.status === "failed" || s.status === "timeout");
  if (stuck) return "stuck";

  if (recent6.some((s) => s.status === "done" || s.status === "completed")) return "idle";

  return "quiet";
}

export function statusLabel(s: FamiliarStatus): string {
  switch (s) {
    case "active": return "active";
    case "stuck":  return "needs attention";
    case "idle":   return "idle";
    case "quiet":  return "quiet";
  }
}

export function statusColor(s: FamiliarStatus): string {
  switch (s) {
    case "active": return "var(--accent-green, #4ade80)";
    case "stuck":  return "var(--accent-amber, #fbbf24)";
    case "idle":   return "var(--text-secondary)";
    case "quiet":  return "var(--border-hairline)";
  }
}
