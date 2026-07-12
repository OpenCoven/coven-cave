"use client";

import { useEffect, useRef, useState } from "react";

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
 */
const POLL_MS = 5000;

type ChangesSummary = {
  /** Number of changed files (0 when clean, when not a repo, or before load). */
  count: number;
  /** True once the first fetch has settled. */
  loaded: boolean;
  /** The root is not a git repo (no diffs to show). */
  notARepo: boolean;
  /** Current branch (null before load, when not a repo, or on an unborn HEAD). */
  branch: string | null;
  /** Linked-worktree name (checkout dir basename) — null in the primary checkout. */
  worktree: string | null;
};

type ChangesResponse = {
  ok?: boolean;
  repo?: boolean;
  files?: unknown[];
  branch?: string | null;
  worktree?: string | null;
};

export function useChangesSummary(
  projectRoot: string | undefined,
  active: boolean,
): ChangesSummary {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [notARepo, setNotARepo] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!active || !projectRoot) return;

    let cancelled = false;
    const load = async () => {
      if (inFlight.current) return;
      if (document.visibilityState !== "visible") return;
      inFlight.current = true;
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ChangesResponse;
        if (cancelled) return;
        if (res.ok && json.ok) {
          setNotARepo(json.repo === false);
          setCount(Array.isArray(json.files) ? json.files.length : 0);
          setBranch(typeof json.branch === "string" ? json.branch : null);
          setWorktree(typeof json.worktree === "string" ? json.worktree : null);
        }
      } catch {
        /* transient — keep the last known summary */
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoaded(true);
      }
    };

    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [projectRoot, active]);

  return { count, loaded, notARepo, branch, worktree };
}
