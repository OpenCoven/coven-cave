// Pure heuristic behind the home composer's suggested-prompt pills. Combines
// open board tasks (newest first, max 2) with curated starters templated on
// the active project name, padding the row to `max`. Deterministic — no
// clock, no randomness — so it unit-tests exactly (home-suggestions.test.ts)
// and the row never flickers between renders with the same state.

export type HomeSuggestion = {
  /** Stable key: "task:<cardId>" or "starter:<index>". */
  id: string;
  /** Full prompt inserted into the composer on click. */
  prompt: string;
};

/** Structural subset of a board card (see cave-board-types.ts) — keeps this
 *  lib dependency-free. */
export type SuggestionCard = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

const OPEN_STATUSES = new Set(["inbox", "backlog"]);
const MAX_TASK_PILLS = 2;

function starters(projectName: string | null | undefined): string[] {
  const scope = projectName?.trim() ? projectName.trim() : "this project";
  return [
    `Give me a tour of ${scope} — what does it do and how is it organized?`,
    `Find and fix a flaky or failing test in ${scope}`,
    "Review my open pull requests and summarize what needs attention",
    "Draft release notes from the changes merged this week",
    "Hunt down TODO/FIXME comments and turn the real ones into tasks",
  ];
}

export function buildHomeSuggestions(input: {
  cards?: SuggestionCard[];
  projectName?: string | null;
  max?: number;
}): HomeSuggestion[] {
  const max = input.max ?? 4;
  const out: HomeSuggestion[] = [];

  const openTasks = (input.cards ?? [])
    .filter((c) => OPEN_STATUSES.has(c.status) && c.title.trim())
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MAX_TASK_PILLS);
  for (const task of openTasks) {
    out.push({ id: `task:${task.id}`, prompt: `Continue the task: ${task.title.trim()}` });
  }

  const pool = starters(input.projectName);
  for (let i = 0; out.length < max && i < pool.length; i++) {
    out.push({ id: `starter:${i}`, prompt: pool[i] });
  }
  return out.slice(0, max);
}
