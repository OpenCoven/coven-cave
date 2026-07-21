"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import { sumFileTotals } from "@/lib/chat-environment-panel-model";
import { usePausablePoll } from "@/lib/use-pausable-poll";

/**
 * Lightweight "are there uncommitted edits?" signal for a project root, without
 * mounting the full SessionChangesPanel. Drives the Code surface's diff-first
 * default: the comux pane auto-switches to the Changes/diff view the moment an
 * agent run produces edits.
 *
 * Mirrors the poll discipline of SessionChangesInner.load
 * (src/components/session-changes-panel.tsx): same /api/changes endpoint, the
 * same 5s interval, document-visibility gating, and a single-flight guard. It is
 * `active`-gated so it pauses (no redundant polling) once the full panel is
 * shown and takes over polling itself.
 *
 * The fetch itself goes through the shared changes-summary gate (cave-v8hh):
 * several subscribers poll the same root at once (composer git chip, stage
 * header, code-rail badge, Changes panel), and the gate collapses each 5s
 * window onto one real request instead of 2-4 identical ones.
 */
const POLL_MS = 5000;

type ChangesSummary = {
  /** Number of changed files (0 when clean, when not a repo, or before load). */
  count: number;
  /** Summed per-file numstat vs HEAD (`+N −N`); untracked files carry no counts. */
  totals: { additions: number; deletions: number };
  /** True once the first fetch has settled. */
  loaded: boolean;
  /** The root is not a git repo (no diffs to show). */
  notARepo: boolean;
  /** Current branch (null before load, when not a repo, or on an unborn HEAD). */
  branch: string | null;
  /** Linked-worktree name (checkout dir basename) — null in the primary checkout. */
  worktree: string | null;
  /** Immediate refetch — for callers that just mutated git state (e.g. the
   *  composer's branch switch) and shouldn't wait out the 5s poll. Forces
   *  through the shared gate so it never reuses a pre-mutation response. */
  reload: () => void;
};

export function useChangesSummary(
  projectRoot: string | undefined,
  active: boolean,
): ChangesSummary {
  const [count, setCount] = useState(0);
  const [totals, setTotals] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 });
  const [loaded, setLoaded] = useState(false);
  const [notARepo, setNotARepo] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Generation guard: bumped whenever (projectRoot, active) changes so a
  // response still in flight for the PREVIOUS root can't write its summary
  // into the new root's state.
  const generation = useRef(0);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!active || !projectRoot) return;
    if (inFlight.current) return;
    if (document.visibilityState !== "visible") return;
    const gen = generation.current;
    inFlight.current = true;
    try {
      const { httpOk, json } = await fetchChangesSummary(projectRoot, opts);
      if (generation.current !== gen) return;
      if (httpOk && json.ok) {
        setNotARepo(json.repo === false);
        setCount(Array.isArray(json.files) ? json.files.length : 0);
        setTotals(sumFileTotals(json.files));
        setBranch(typeof json.branch === "string" ? json.branch : null);
        setWorktree(typeof json.worktree === "string" ? json.worktree : null);
      }
    } catch {
      /* transient — keep the last known summary */
    } finally {
      inFlight.current = false;
      if (generation.current === gen) setLoaded(true);
    }
  }, [projectRoot, active]);

  // Initial load per (root, active) change; the recurring poll + the
  // on-return refresh are usePausablePoll's job (cave-e794 — this hook used
  // to hand-roll the interval + visibilitychange trio the shared hook
  // centralizes).
  useEffect(() => {
    generation.current += 1;
    if (!active || !projectRoot) return;
    void load();
  }, [load, projectRoot, active]);

  usePausablePoll(() => void load(), POLL_MS, { enabled: active && Boolean(projectRoot) });

  const reload = useCallback(() => {
    void load({ force: true });
  }, [load]);

  return { count, totals, loaded, notARepo, branch, worktree, reload };
}
