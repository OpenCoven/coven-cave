"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatProjectGroup } from "@/lib/chat-projects";
import {
  autoExpandKeysForNewSessions,
  projectSelectionKeys,
} from "@/lib/chat-project-selection";

type Baseline = { sessionIds: Set<string>; groupKeys: Set<string> };

/**
 * Auto-expand rail folders that gain a genuinely new chat (cave-mllp).
 *
 * The first hydrated run only captures a baseline — groups the user
 * deliberately collapsed (absent from the persisted expanded-keys) must stay
 * collapsed. After that, each refresh expands the keys
 * `autoExpandKeysForNewSessions` selects, exactly once per key: a later
 * manual re-collapse wins because the session ids are already known by then.
 *
 * `sessions` must be the RAW (unfiltered) rows so a familiar switch that
 * merely reveals previously filtered groups never reads as "new chats".
 */
export function useAutoExpandNewGroups(args: {
  hydrated: boolean;
  sessions: readonly { id: string }[];
  groups: ChatProjectGroup[];
  activeSessionId: string | null;
  setExpandedKeys: Dispatch<SetStateAction<string[]>>;
}): void {
  const { hydrated, sessions, groups, activeSessionId, setExpandedKeys } = args;
  const baselineRef = useRef<Baseline | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const known = baselineRef.current;
    if (known === null) {
      baselineRef.current = {
        sessionIds: new Set([
          ...sessions.map((s) => s.id),
          ...groups.flatMap((g) => g.sessions.map((s) => s.id)),
        ]),
        groupKeys: new Set(projectSelectionKeys(groups)),
      };
      return;
    }
    const expandKeys = autoExpandKeysForNewSessions({
      groups,
      knownSessionIds: known.sessionIds,
      knownGroupKeys: known.groupKeys,
      activeSessionId,
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
  }, [hydrated, sessions, groups, activeSessionId, setExpandedKeys]);
}
