/**
 * navigator-charts — the Chart Room's lane vocabulary and its status chip.
 *
 * The room's charting rules live in `chart-room-model.ts`; what stays here is
 * the lane order every other module reads from, and the one-line status the
 * registration manifest shows without mounting the room.
 *
 * Kept JSX-free (type-only imports) so the rules are unit-testable under plain
 * `node --experimental-strip-types`.
 */

import type { CardStatus } from "@/lib/cave-board-types";

/** Lane order the room charts a course through — mirrors the board's STATUSES. */
export const COURSE_LANES: CardStatus[] = ["backlog", "inbox", "running", "review", "blocked", "done"];

export type ChartRoomStatus = {
  label: string;
  tone: "ok" | "busy" | "warn";
};

/** The room's one-line status chip, derived from the latest lane counts. */
export function chartRoomStatus(counts: { running: number; blocked: number }): ChartRoomStatus {
  if (counts.blocked > 0) {
    return { label: `${counts.blocked} blocked`, tone: "warn" };
  }
  if (counts.running > 0) {
    return { label: `${counts.running} underway`, tone: "busy" };
  }
  return { label: "charts clear", tone: "ok" };
}
