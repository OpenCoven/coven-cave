"use client";

/**
 * HomeSuggestions — the ✦ suggested-prompt pills between the composer card
 * and the Continue/News columns. Suggestions come from the pure heuristic in
 * lib/home-suggestions (open board tasks + curated starters); clicking a pill
 * inserts the prompt into the composer (never auto-sends).
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  buildHomeSuggestions,
  type SuggestionCard,
} from "@/lib/home-suggestions";

type Props = {
  projectName: string | null;
  /** Insert the prompt into the composer textarea and focus it. */
  onPick: (prompt: string) => void;
};

export function HomeSuggestions({ projectName, onPick }: Props) {
  const [cards, setCards] = useState<SuggestionCard[]>([]);

  // Board tasks feed the heuristic; a failed fetch simply leaves the curated
  // starters (the row itself never errors and never renders empty).
  useEffect(() => {
    let alive = true;
    fetch("/api/board", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !Array.isArray(j.cards)) return;
        setCards(
          j.cards.map((c: SuggestionCard) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            updatedAt: c.updatedAt,
          })),
        );
      })
      .catch(() => {
        /* starters-only fallback */
      });
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(
    () => buildHomeSuggestions({ cards, projectName }),
    [cards, projectName],
  );

  return (
    <div className="home-suggestions" role="group" aria-label="Suggested prompts">
      {suggestions.map((s) => {
        // "task:" pills resume real board work; starters are fresh prompts.
        // The icon encodes the difference so the row scans at a glance.
        const isTask = s.id.startsWith("task:");
        return (
          <button
            key={s.id}
            type="button"
            className={`home-suggestion-pill focus-ring${isTask ? " home-suggestion-pill--task" : ""}`}
            onClick={() => onPick(s.prompt)}
            title={s.prompt}
          >
            <Icon name={isTask ? "ph:kanban" : "ph:sparkle"} width={11} aria-hidden />
            <span className="home-suggestion-label">{s.prompt}</span>
          </button>
        );
      })}
    </div>
  );
}
