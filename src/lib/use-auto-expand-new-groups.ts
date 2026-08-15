"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatProjectGroup } from "@/lib/chat-projects";
import {
  autoExpandKeysForNewSessions,
  projectSelectionKeys,
} from "@/lib/chat-project-selection";

type Baseline = {
  scopeKey: string;
  sessionIds: Set<string>;
  groupKeys: Set<string>;
  capturedAtMs: number;
};

/** Sessions created within this window before baseline capture still count
 *  as "new" — absorbs client/daemon clock skew and a chat started moments
 *  before this surface hydrated. */
const BASELINE_SKEW_MS = 5 * 60 * 1000;

/**
 * Auto-expand rail folders that gain a genuinely new chat (cave-mllp).
 *
 * The first hydrated run and each scope change only capture a baseline —
 * groups the user deliberately collapsed (absent from the persisted
 * expanded-keys) must stay collapsed. After that, each refresh expands the keys
 * `autoExpandKeysForNewSessions` selects, exactly once per key: a later
 * manual re-collapse wins because the session ids are already known by then.
 *
 * Recency is the guard that keeps "first seen here" from being mistaken for
 * "new" (cave-a9w9): a failed/partial first load poisons the baseline
 * (hydration flips even when /api/sessions/list errors), and poll recovery,
 * daemon backfill then delivers OLD chats under unseen keys. New-folder
 * expansion additionally requires a chat created after baseline capture
 * (minus skew), so those reveals never bulk-open folders — while a genuine
 * first chat after an empty start still expands. Only the ACTIVE chat bypasses
 * recency.
 *
 * `sessions` are the raw rows within the current server-provided scope.
 * `scopeKey` identifies that scope; changing it replaces the baseline so
 * revealed chats never read as newly created.
 */
export function useAutoExpandNewGroups(args: {
  hydrated: boolean;
  scopeKey: string;
  sessions: readonly { id: string }[];
  groups: ChatProjectGroup[];
  activeSessionId: string | null;
  setExpandedKeys: Dispatch<SetStateAction<string[]>>;
}): void {
  const { hydrated, scopeKey, sessions, groups, activeSessionId, setExpandedKeys } = args;
  const baselineRef = useRef<Baseline | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const known = baselineRef.current;
    if (known === null || known.scopeKey !== scopeKey) {
      baselineRef.current = {
        scopeKey,
        sessionIds: new Set([
          ...sessions.map((s) => s.id),
          ...groups.flatMap((g) => g.sessions.map((s) => s.id)),
        ]),
        groupKeys: new Set(projectSelectionKeys(groups)),
        capturedAtMs: Date.now(),
      };
      return;
    }
    const expandKeys = autoExpandKeysForNewSessions({
      groups,
      knownSessionIds: known.sessionIds,
      knownGroupKeys: known.groupKeys,
      activeSessionId,
      newSinceMs: known.capturedAtMs - BASELINE_SKEW_MS,
    });
    // Grow the baselines only after computing, so this run's fresh sessions
    // count — and the next run treats them as known (expand-once semantics).
    for (const s of sessions) known.sessionIds.add(s.id);
    for (const g of groups) for (const s of g.sessions) known.sessionIds.add(s.id);
    for (const key of projectSelectionKeys(groups)) known.groupKeys.add(key);
    if (expandKeys.length === 0) return;
    setExpandedKeys((prev) => {
      const missing = expandKeys.filter((key) => !prev.includes(key));
      return missing.length ? [...prev, ...missing] : prev;
    });
  }, [hydrated, scopeKey, sessions, groups, activeSessionId, setExpandedKeys]);
}
