"use client";

// Demoted suggestion pills (chat revamp 1a, minimal pass): two cold-start
// prompts in one quiet row below the composer — open board tasks first, then
// curated starters (buildHomeSuggestions). Same insert-never-send contract.
// The composer hides the row entirely once a draft exists: suggestions are
// for the blank-page moment, not for reading around while you type.
//
// Row layout obeys the uniform-rows rule (#2672): the grid is keyed off
// data-count so pills lay out 1 or 2 per row and never orphan.

import { useMemo } from "react";
import { buildHomeSuggestions, type SuggestionCard } from "@/lib/home-suggestions";

type Props = {
  /** The shared /api/board snapshot (use-board-cards). */
  cards: SuggestionCard[];
  /** Active project name — seasons the curated starters. */
  projectName: string | null;
  /** Insert the prompt into the composer (never auto-sends). */
  onPick: (prompt: string) => void;
};

export function HomeSuggestionPills({ cards, projectName, onPick }: Props) {
  const suggestions = useMemo(
    () => buildHomeSuggestions({ cards, projectName, max: 2 }),
    [cards, projectName],
  );
  if (suggestions.length === 0) return null;
  return (
    <div
      className="home-suggest-pills"
      data-count={suggestions.length}
      role="group"
      aria-label="Suggested prompts"
    >
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          className="home-suggest-pill"
          onClick={() => onPick(s.prompt)}
          title={s.prompt}
        >
          <span className="home-suggest-pill__text">{s.prompt}</span>
        </button>
      ))}
    </div>
  );
}
