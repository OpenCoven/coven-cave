/**
 * navigator-charts — pure charting logic for the Navigator's Chart Room.
 *
 * Course lanes, leg scheduling, and progress derivation over the Cave's real
 * board cards. Kept JSX-free (type-only imports) so the rules are
 * unit-testable under plain `node --experimental-strip-types`.
 */

import type { Card, CardStatus } from "@/lib/cave-board-types";

/** Lane order the room charts a course through — mirrors the board's STATUSES. */
export const COURSE_LANES: CardStatus[] = ["backlog", "inbox", "running", "review", "blocked", "done"];

/** Cards the navigator charts: assigned to this familiar, or still unassigned. */
export function scopeCards<T extends Pick<Card, "familiarId">>(cards: readonly T[], familiarId: string): T[] {
  return cards.filter((card) => card.familiarId == null || card.familiarId === familiarId);
}

export function groupByLane<T extends Pick<Card, "status">>(
  cards: readonly T[],
): Array<{ status: CardStatus; cards: T[] }> {
  return COURSE_LANES.map((status) => ({ status, cards: cards.filter((card) => card.status === status) }));
}

export type CardProgress = {
  done: number;
  total: number;
  /** "3/5 steps" or "no steps" — honest when a card carries none. */
  label: string;
};

export function cardProgress(card: Pick<Card, "steps">): CardProgress {
  const total = card.steps.length;
  const done = card.steps.filter((step) => step.done).length;
  return { done, total, label: total === 0 ? "no steps" : `${done}/${total} steps` };
}

export type Leg<T> = {
  card: T;
  /** The date the leg sorts on: startDate, else endDate. */
  sailsOn: string;
  /** Past its endDate without reaching done. */
  overdue: boolean;
};

/**
 * The scheduled legs of the voyage: undone cards carrying a start or end date,
 * soonest first. `today` is a YYYY-MM-DD string so date math stays lexical.
 */
export function upcomingLegs<T extends Pick<Card, "status" | "startDate" | "endDate">>(
  cards: readonly T[],
  today: string,
  cap = 8,
): Leg<T>[] {
  return cards
    .filter((card) => card.status !== "done" && (card.startDate || card.endDate))
    .map((card) => ({
      card,
      sailsOn: (card.startDate || card.endDate) as string,
      overdue: card.endDate != null && card.endDate !== "" && card.endDate < today,
    }))
    .sort((a, b) => a.sailsOn.localeCompare(b.sailsOn))
    .slice(0, cap);
}

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
