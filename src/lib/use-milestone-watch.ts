"use client";

import { useCallback, useEffect, useRef } from "react";
import { covenStreak, deriveRenown } from "@/lib/familiar-renown";
import {
  dueCovenMilestones,
  dueTierMilestones,
  type MilestoneAward,
  type TierAscension,
} from "@/lib/milestone-defs";
import type { Familiar, SessionRow } from "@/lib/types";
import { usePausablePoll } from "@/lib/use-pausable-poll";

/**
 * Watches for milestone crossings and reports them to /api/milestones. The
 * server dedupes against the renown ledger, so duplicate reports (two
 * windows, re-mounts, repeat checks) are harmless no-ops; new awards ride
 * the existing inbox channel out as milestone toasts.
 *
 * Self-contained on purpose: the workspace's session list is scoped to the
 * active familiar, so this hook fetches its own unscoped roster + sessions
 * (plus memory counts) once per check — coven-wide milestones must see the
 * whole coven. When the daemon is down a check proceeds with whatever
 * loaded; scores only ever read lower, so a milestone can fire late but
 * never early.
 */

const CHECK_INTERVAL_MS = 10 * 60_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type MemoryEntryLite = { familiar_id?: string };

export function useMilestoneWatch(enabled = true) {
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const ledger = await getJson<{ ok?: boolean; awarded?: string[] }>("/api/milestones");
      if (!ledger?.ok || !Array.isArray(ledger.awarded)) return;
      const awarded = new Set(ledger.awarded);

      const [familiarsRes, sessionsRes, memoryRes] = await Promise.all([
        getJson<{ ok?: boolean; familiars?: Familiar[] }>("/api/familiars"),
        getJson<{ ok?: boolean; sessions?: SessionRow[] }>("/api/sessions/list"),
        getJson<{ ok?: boolean; entries?: MemoryEntryLite[] }>("/api/coven-memory"),
      ]);
      const familiars = familiarsRes?.ok ? (familiarsRes.familiars ?? []) : [];
      const sessions = sessionsRes?.ok ? (sessionsRes.sessions ?? []) : [];
      if (familiars.length === 0) return;

      const memoryCounts = new Map<string, number>();
      for (const entry of memoryRes?.entries ?? []) {
        if (typeof entry?.familiar_id !== "string") continue;
        memoryCounts.set(entry.familiar_id, (memoryCounts.get(entry.familiar_id) ?? 0) + 1);
      }
      const live = sessions.filter((s) => !s.archived_at);
      const bySessions = new Map<string, number>();
      for (const s of live) {
        if (!s.familiarId) continue;
        bySessions.set(s.familiarId, (bySessions.get(s.familiarId) ?? 0) + 1);
      }
      const tierRows: TierAscension[] = familiars.map((f) => {
        const renown = deriveRenown({
          sessionsTotal: bySessions.get(f.id) ?? 0,
          memoryCount: memoryCounts.get(f.id) ?? 0,
        });
        return {
          familiarId: f.id,
          displayName: f.display_name || f.id,
          tierKey: renown.tier.key,
          tierLabel: renown.tier.label,
        };
      });

      const due: MilestoneAward[] = [
        ...dueCovenMilestones(
          {
            familiarCount: familiars.length,
            sessionsTotal: live.length,
            covenStreakDays: covenStreak(sessions, Date.now()),
          },
          awarded,
        ),
        ...dueTierMilestones(tierRows, awarded),
      ];
      if (due.length === 0) return;
      await fetch("/api/milestones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ awards: due }),
      });
    } catch {
      // Milestones are ornament, never load-bearing — stay quiet on failure.
    } finally {
      busyRef.current = false;
    }
  }, []);

  // One check on mount; the recurring poll goes through usePausablePoll so a
  // hidden tab stops hitting the network (poll-discipline gate).
  useEffect(() => {
    if (!enabled) return;
    void check();
  }, [enabled, check]);
  usePausablePoll(() => void check(), CHECK_INTERVAL_MS, { enabled });
}
