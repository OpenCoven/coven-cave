"use client";

/**
 * Live working-tree changes for one project root (cave-0rcku).
 *
 * The Coding Room needs the same `/api/changes` summary in three places at
 * once — the file tree's status marks, the tree's "N changed" filter, and the
 * review rail's diffstat header — and the frame shows them agreeing. A single
 * hook over the shared, deduped summary gate (`changes-summary-fetch`) is what
 * makes that agreement structural rather than coincidental: three subscribers
 * on the same root collapse onto one request per poll window.
 *
 * Polling only runs while the document is visible and the session is running.
 * A hidden tab that keeps shelling out to `git status` every five seconds is a
 * background CPU cost with nobody looking at the result.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import type { ChangedFile } from "@/lib/session-changes-api";

const POLL_MS = 5000;

export type WorktreeChanges = {
  files: ChangedFile[];
  /** Absolute repo root the paths are relative to, once known. */
  repoRoot: string | null;
  additions: number;
  deletions: number;
  loaded: boolean;
  /** Refetch now, bypassing the microcache (used after a mutation). */
  refresh: () => void;
};

export function useWorktreeChanges(projectRoot: string, running: boolean): WorktreeChanges {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(
    async (opts?: { shared?: boolean }) => {
      if (!projectRoot || inFlight.current) return;
      inFlight.current = true;
      try {
        const { httpOk, json } = await fetchChangesSummary(projectRoot, { force: !opts?.shared });
        const payload = json as { ok?: boolean; files?: ChangedFile[]; repoRoot?: string | null };
        if (!httpOk || !payload.ok) return;
        setRepoRoot(payload.repoRoot ?? null);
        // Content-guard: an unchanged poll keeps the previous array reference so
        // the tree and the rail do not re-render every five seconds while an
        // agent is mid-edit.
        const next = payload.files ?? [];
        setFiles((prev) => (arrayContentEqual(prev, next) ? prev : next));
      } catch {
        /* keep the last known summary — a transient failure is not "clean" */
      } finally {
        inFlight.current = false;
        setLoaded(true);
      }
    },
    [projectRoot],
  );

  useEffect(() => {
    setLoaded(false);
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onRefresh = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("cave:changes-refresh", onRefresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("cave:changes-refresh", onRefresh);
    };
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ shared: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, running]);

  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.insertions ?? 0;
    deletions += file.deletions ?? 0;
  }

  return { files, repoRoot, additions, deletions, loaded, refresh: () => void load() };
}
