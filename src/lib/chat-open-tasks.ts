// Derivations for the chat starting page's task-aware sections: the familiar's
// open board cards ("Open work") and its recent threads ("Continue"). Pure and
// clock-injected (same convention as chat-recency.ts) so tests pin exact
// ordering without a live board. Relative imports keep the test loader-free.

import type { Card, CardPriority, CardStatus } from "./cave-board-types.ts";
import type { SessionRow } from "./types.ts";
import { filterVisibleChatSessions } from "./chat-projects.ts";

/** Card statuses that count as "open work" on the starting page. `backlog` is
 *  deliberately excluded — the rail invites resuming active work, not triaging
 *  the whole backlog; `done` is finished. */
const OPEN_STATUSES: readonly CardStatus[] = ["running", "review", "blocked", "inbox"];

const STATUS_RANK = new Map<CardStatus, number>(OPEN_STATUSES.map((s, i) => [s, i]));
const PRIORITY_RANK = new Map<CardPriority, number>([
  ["urgent", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

export type OpenTaskRail = {
  /** Active-first, capped list for the rail. */
  cards: Card[];
  /** How many matching open cards were cut by the cap. */
  moreCount: number;
};

/** Whether a card belongs to the selected project scope. No project selected
 *  matches everything; card.cwd is the fallback match for legacy cards that
 *  predate projectId; an unscoped card (no project association) always
 *  matches — it's still the familiar's work. */
export function cardMatchesProject(
  card: Card,
  opts: { projectId?: string | null; projectRoot?: string | null },
): boolean {
  if (!opts.projectId) return true;
  if (card.projectId) return card.projectId === opts.projectId;
  if (card.cwd && opts.projectRoot) return card.cwd === opts.projectRoot;
  return !card.cwd;
}

/** All of a familiar's open cards for the current project scope, active-first.
 *  Uncapped — feeds both the rail (capped below) and the starter suggestions
 *  (which need e.g. the full review count). */
export function deriveOpenTaskCards(
  cards: Card[],
  opts: {
    familiarId: string;
    /** Selected project (stable id) — when set, scope to it; card.cwd is the
     *  fallback match for legacy cards that predate projectId. */
    projectId?: string | null;
    projectRoot?: string | null;
  },
): Card[] {
  return cards
    .filter((card) => card.familiarId === opts.familiarId)
    .filter((card) => STATUS_RANK.has(card.status))
    .filter((card) => cardMatchesProject(card, opts))
    .sort((a, b) => {
      const status = (STATUS_RANK.get(a.status) ?? 9) - (STATUS_RANK.get(b.status) ?? 9);
      if (status !== 0) return status;
      const priority =
        (PRIORITY_RANK.get(a.priority) ?? 9) - (PRIORITY_RANK.get(b.priority) ?? 9);
      if (priority !== 0) return priority;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
}

export function deriveOpenTaskRail(
  cards: Card[],
  opts: {
    familiarId: string;
    projectId?: string | null;
    projectRoot?: string | null;
    cap?: number;
  },
): OpenTaskRail {
  const cap = opts.cap ?? 4;
  const matches = deriveOpenTaskCards(cards, opts);
  return { cards: matches.slice(0, cap), moreCount: Math.max(0, matches.length - cap) };
}

export function deriveContinueThreads(
  sessions: SessionRow[],
  opts: {
    familiarId: string;
    /** When a project is selected, only threads rooted in it. */
    projectRoot?: string | null;
    /** The thread being viewed (zero-turn existing session) — never suggest itself. */
    excludeSessionId?: string | null;
    cap?: number;
  },
): SessionRow[] {
  const cap = opts.cap ?? 3;
  return filterVisibleChatSessions(sessions, opts.familiarId)
    .filter((session) => !opts.excludeSessionId || session.id !== opts.excludeSessionId)
    .filter((session) => !opts.projectRoot || session.project_root === opts.projectRoot)
    .slice(0, cap);
}
