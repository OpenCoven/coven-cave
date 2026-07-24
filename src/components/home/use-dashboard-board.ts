"use client";

// Board snapshot for the Home dashboard's "Open work" board (launcher 3a).
// One /api/board GET, mapped to the lean fields the board rows and filter tabs
// need: title, column status (→ row kind + chip), priority, and — for running
// cards — the timeout badge inputs (runningSince/timeoutMs). A failed fetch
// leaves the empty list so the board degrades to an empty state, never errors.
//
// This is a SEPARATE fetch from use-board-cards (the suggestion/pending-task
// helper) because the dashboard needs the richer per-card lifecycle fields
// that helper deliberately drops.

import { useEffect, useState } from "react";
import type { CardLifecycle, CardPriority, CardStatus } from "@/lib/cave-board-types";

export type DashboardCard = {
  id: string;
  title: string;
  status: CardStatus;
  priority: CardPriority;
  lifecycle: CardLifecycle;
  updatedAt: string;
  runningSince?: string;
  timeoutMs?: number;
  needsHuman?: boolean;
};

export function useDashboardBoard(): DashboardCard[] {
  const [cards, setCards] = useState<DashboardCard[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/board", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !Array.isArray(j.cards)) return;
        setCards(
          j.cards.map(
            (c: DashboardCard): DashboardCard => ({
              id: c.id,
              title: c.title,
              status: c.status,
              priority: c.priority,
              lifecycle: c.lifecycle,
              updatedAt: c.updatedAt,
              runningSince: c.runningSince,
              timeoutMs: c.timeoutMs,
              needsHuman: c.needsHuman,
            }),
          ),
        );
      })
      .catch(() => {
        /* board unreachable — the board degrades to an empty state */
      });
    return () => {
      alive = false;
    };
  }, []);
  return cards;
}
