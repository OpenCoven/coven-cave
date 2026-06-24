// Pure derivation of a session row's leading glyph for the Projects tab. Maps a
// SessionRow to a small descriptor the row renders as either a status icon
// (running / failed / task) or the calm status dot (plain chat). Self-contained
// (no React, type-only import) so it unit-tests under the strip-types runner.

import type { SessionRow } from "../types.ts";
import type { IconName } from "../icon";

export type SessionGlyphKind = "running" | "failed" | "task" | "chat";
export type SessionGlyphTone = "accent" | "danger" | "success" | "muted";

export type SessionGlyph = {
  kind: SessionGlyphKind;
  tone: SessionGlyphTone;
  /** Phosphor icon name for running/failed/task; null for plain chat (render the dot). */
  icon: IconName | null;
  /** Whether the icon should spin (running only). */
  spin: boolean;
  /** Accessible label for the glyph (title / aria). */
  label: string;
};

const TASK_TITLE_RE = /^\s*task:\s*/i;

/**
 * A session is "task"-shaped when it was opened from a board card (origin
 * "board") or its title carries the "Task: " label the board→chat bridge adds.
 */
export function isTaskSession(session: Pick<SessionRow, "origin" | "title">): boolean {
  return session.origin === "board" || TASK_TITLE_RE.test(session.title ?? "");
}

/** Drop a leading "Task: " label — the kind is shown as a glyph instead. */
export function stripTaskPrefix(title: string): string {
  return title.replace(TASK_TITLE_RE, "");
}

/** Leading glyph for a session row, in precedence order: running > failed > task > chat. */
export function sessionGlyph(
  session: Pick<SessionRow, "status" | "origin" | "title">,
): SessionGlyph {
  if (session.status === "running")
    return { kind: "running", tone: "accent", icon: "ph:circle-notch-bold", spin: true, label: "Running" };
  if (session.status === "failed" || session.status === "error")
    return { kind: "failed", tone: "danger", icon: "ph:warning-circle-fill", spin: false, label: "Failed" };
  if (isTaskSession(session))
    return { kind: "task", tone: "muted", icon: "ph:check-square", spin: false, label: "Task" };
  return { kind: "chat", tone: "muted", icon: null, spin: false, label: "Chat" };
}

/** Tailwind text-color class for a glyph tone (shared by icon + dot). */
export function glyphToneClass(tone: SessionGlyphTone): string {
  switch (tone) {
    case "accent":
      return "text-[var(--accent-presence)]";
    case "danger":
      return "text-[var(--color-danger)]";
    case "success":
      return "text-[var(--color-success)]";
    default:
      return "text-[var(--text-muted)]";
  }
}
