"use client";

// "From task" — the row under the composer when home was opened from a task
// (chat revamp 1a): task icon + accent label + ellipsized task title + up to
// three suggestion chips that insert into the composer.
//
// NOTE(unwired): the codebase has no task→home handoff today — board cards
// open chats directly (pending-chat-action), never the home composer — so
// HomeComposer currently renders this with `origin={null}` (always hidden).
// The row is prop-driven and ready for the first surface that routes a task
// INTO home: pass `{ title, suggestions }` and it lights up.

import { Icon } from "@/lib/icon";

export type HomeTaskOrigin = {
  title: string;
  /** Task-seasoned prompt starters; capped at 3 chips (uniform-row rule). */
  suggestions?: string[];
};

type Props = {
  origin: HomeTaskOrigin | null;
  /** A chip inserts its prompt into the composer (never auto-sends). */
  onPickSuggestion: (prompt: string) => void;
};

export function HomeFromTaskRow({ origin, onPickSuggestion }: Props) {
  if (!origin) return null;
  const chips = (origin.suggestions ?? []).slice(0, 3);
  return (
    <div className="home-from-task">
      <Icon name="ph:check-square" width={12} className="home-from-task__icon" aria-hidden />
      <span className="home-from-task__label">From task</span>
      <span className="home-from-task__title" title={origin.title}>
        {origin.title}
      </span>
      {chips.length ? (
        <span className="home-from-task__chips">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="home-from-task__chip"
              onClick={() => onPickSuggestion(chip)}
            >
              {chip}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}
