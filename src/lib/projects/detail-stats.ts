/**
 * Pure derivation for the detail pane's stat strip (Sessions / Open tasks /
 * Familiars / Last active) and the rail rows' meta line. Everything binds to
 * data the surface already loads — sessions, board cards, grants — so the
 * strip never fabricates state.
 */

import type { Card } from "../cave-board-types.ts";

export type DetailStatStrip = {
  sessions: string;
  openTasks: string;
  familiars: string;
  lastActive: string;
};

/** Open (not-done) board cards — the "Open tasks" number everywhere. */
export function openTaskCount(projectCards: readonly Card[]): number {
  return projectCards.reduce((n, card) => n + (card.status === "done" ? 0 : 1), 0);
}

export function deriveStatStrip(input: {
  sessionCount: number;
  openTasks: number;
  grantedCount: number;
  rosterCount: number;
  lastActiveLabel: string | null;
}): DetailStatStrip {
  return {
    sessions: String(input.sessionCount),
    openTasks: String(input.openTasks),
    familiars:
      input.rosterCount > 0 ? `${input.grantedCount} / ${input.rosterCount}` : "—",
    lastActive: input.lastActiveLabel || "—",
  };
}

/** Rail row meta: "3 chats · main" / "1 chat" / "main" / "" — only real data,
 *  joined with the interpunct when both halves exist. */
export function railRowMeta(chatCount: number, branch: string | null): string {
  const chats = chatCount > 0 ? `${chatCount} ${chatCount === 1 ? "chat" : "chats"}` : "";
  if (chats && branch) return `${chats} · ${branch}`;
  return chats || branch || "";
}
