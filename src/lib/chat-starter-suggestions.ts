// Context-aware starter prompts for the chat starting page. Replaces the old
// static STARTER_PROMPTS array: each suggestion earns its slot from actual
// state (cards in review, sessions today, a selected project) instead of
// promising actions that can't apply. Pure and clock-injected (chat-recency.ts
// convention); relative imports keep the test loader-free.

import type { Card } from "./cave-board-types.ts";
import type { SessionRow } from "./types.ts";
import { buildHomeSuggestions, type SuggestionCard } from "./home-suggestions.ts";

export type StarterSuggestion = {
  id: string;
  /** Button label — terse, next-step voice. */
  label: string;
  /** Text placed into the composer on click (not auto-sent). */
  text: string;
};

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isToday(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return startOfLocalDay(then) === startOfLocalDay(nowMs);
}

export function deriveStarterSuggestions(opts: {
  /** Familiar-scoped open cards (the rail's input, pre-cap). */
  cards: Card[];
  /** Familiar-scoped sessions (already visibility-filtered). */
  sessions: SessionRow[];
  /** Resumable board cards (unassigned + this familiar's, project-scoped) —
   *  rendered as "Continue the task: X" pills ahead of the starters, via the
   *  same heuristic the home composer uses (buildHomeSuggestions). */
  taskCards?: SuggestionCard[];
  projectName?: string | null;
  nowMs: number;
  cap?: number;
}): StarterSuggestion[] {
  const cap = opts.cap ?? 4;
  const out: StarterSuggestion[] = [];

  // Task-resume pills lead — resuming named work beats a generic starter.
  // buildHomeSuggestions owns the heuristic (inbox/backlog only, newest
  // first, max 2); filtering to task: ids drops its starter padding.
  for (const s of buildHomeSuggestions({ cards: opts.taskCards ?? [], max: cap })) {
    if (s.id.startsWith("task:")) out.push({ id: s.id, label: s.prompt, text: s.prompt });
  }

  const reviewCount = opts.cards.filter((card) => card.status === "review").length;
  if (reviewCount > 0) {
    const noun = reviewCount === 1 ? "task" : "tasks";
    out.push({
      id: "review-cards",
      label: `Check the ${reviewCount} ${noun} in review`,
      text: `Go over the ${noun} waiting in review and summarise what's left on each.`,
    });
  }

  const workedToday = opts.sessions.some((session) =>
    isToday(session.updated_at || session.created_at, opts.nowMs),
  );
  if (workedToday) {
    out.push({
      id: "summarise-today",
      label: "Summarise what I worked on today",
      text: "Summarise what I worked on today",
    });
  }

  if (opts.projectName) {
    out.push({
      id: "review-changes",
      label: "Review my recent changes",
      text: "Review my recent changes",
    });
    out.push({
      id: "plan-feature",
      label: "Plan a feature and break it into board cards",
      text: "Plan a feature and break it into board cards",
    });
  }

  // Pad so the page always offers at least two ways in.
  const fallbacks: StarterSuggestion[] = [
    {
      id: "capabilities",
      label: "What can you help me with?",
      text: "What can you help me with?",
    },
    {
      id: "focused-task",
      label: "Start a focused task",
      text: "Start a focused task",
    },
  ];
  for (const fallback of fallbacks) {
    if (out.length >= 2) break;
    if (!out.some((s) => s.id === fallback.id)) out.push(fallback);
  }

  return out.slice(0, cap);
}
