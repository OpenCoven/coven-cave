"use client";

// One /api/board snapshot for the home hearth card. Both the suggestion pills
// (task-derived prompts) and the Open work section (pending-task row) read the
// same fetch, so home never issues duplicate board requests. A failed fetch
// simply leaves the empty list — the consumers degrade (curated starters only,
// no task row) instead of erroring.

import { useEffect, useState } from "react";
import type { SuggestionCard } from "@/lib/home-suggestions";

/** Board statuses that read as "pending work" on home (mirrors the private
 *  OPEN_STATUSES set inside lib/home-suggestions). */
const PENDING_STATUSES = new Set(["inbox", "backlog"]);

export function pendingBoardTasks(cards: SuggestionCard[]): SuggestionCard[] {
  return cards
    .filter((c) => PENDING_STATUSES.has(c.status) && c.title.trim())
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function useBoardCards(): SuggestionCard[] {
  const [cards, setCards] = useState<SuggestionCard[]>([]);
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
        /* board unreachable — consumers degrade gracefully */
      });
    return () => {
      alive = false;
    };
  }, []);
  return cards;
}
