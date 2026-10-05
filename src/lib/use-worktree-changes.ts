"use client";

/**
 * Live working-tree changes for one project root (cave-0rcku).
 *
 * The Coding Desk needs the same `/api/changes` summary in three places at
 * once — the file tree's status marks, the tree's "N changed" filter, and the
 * review rail's diffstat header — and the frame shows them agreeing. A single
 * hook over the shared, deduped summary gate (`changes-summary-fetch`) is what
 * makes that agreement structural rather than coincidental: three subscribers
 * on the same root collapse onto one request per poll window.
 *
 * Polling only runs while the document is visible: every five seconds while
 * the session runs, and every twenty while it is idle (#5795). A hidden tab
 * that keeps shelling out to `git status` is a background CPU cost with nobody
 * looking at the result.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import { createChangesLedger, type ChangesLedger } from "@/lib/worktree-changes-ledger";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { ChangedFile } from "@/lib/session-changes-api";

const POLL_MS = 5000;
/** An idle session's poll (#5795). Nothing re-read an idle session's working
 *  tree while the page was visible, so an edit from its own terminal or an
 *  outside editor stayed invisible, and the next commit met a stale list. */
export const CHANGES_IDLE_POLL_MS = 20_000;

export type WorktreeChanges = {
  files: ChangedFile[];
  /** Absolute repo root the paths are relative to, once known. */
  repoRoot: string | null;
  additions: number;
  deletions: number;
  loaded: boolean;
  /** At least one request for this root succeeded. `loaded` is also true after
   *  a failed first request, which must not read as a clean worktree. */
  ok: boolean;
  /** The work root is no longer on disk (#5781). */
  missingRoot: boolean;
  /** Refetch now, bypassing the microcache (used after a mutation). */
  refresh: () => void;
};

type ChangesSnapshot = {
  /** The root this snapshot describes. */
  root: string;
  files: ChangedFile[];
  repoRoot: string | null;
  loaded: boolean;
  ok: boolean;
  missingRoot: boolean;
};

const NO_FILES: ChangedFile[] = [];

function emptySnapshot(root: string): ChangesSnapshot {
  return { root, files: NO_FILES, repoRoot: null, loaded: false, ok: false, missingRoot: false };
}

export function useWorktreeChanges(projectRoot: string, running: boolean): WorktreeChanges {
  // One snapshot, tagged with the root it describes (#5729 review). Separate
  // state reset in an effect still returned the previous root's files on the
  // first render after a root change, and the desk drew them under the new
  // root. Until the snapshot is this root's, the hook reports an empty,
  // unloaded summary.
  const [snapshot, setSnapshot] = useState<ChangesSnapshot>(() => emptySnapshot(projectRoot));
  const view = snapshot.root === projectRoot ? snapshot : emptySnapshot(projectRoot);

  // A session's work root can change on the same mount — enrichment adds
  // `git.worktreeRoot` on a later poll. The ledger gives every root a new
  // generation, and only a request from the current generation may apply its
  // answer, free the in-flight slot or run a queued reload; a root alone is
  // not enough after A → B → A (see worktree-changes-ledger.ts).
  const ledgerRef = useRef<ChangesLedger | null>(null);
  ledgerRef.current ??= createChangesLedger();
  const ledger = ledgerRef.current;

  const load = useCallback(
    async (opts?: { shared?: boolean }) => {
      const root = projectRoot;
      if (!root) return;
      const ticket = ledger.begin(opts);
      if (!ticket) return;
      let reload = false;
      try {
        const { httpOk, json } = await fetchChangesSummary(root, { force: !opts?.shared });
        if (!ledger.accepts(ticket)) return;
        const payload = json as { ok?: boolean; files?: ChangedFile[]; repoRoot?: string | null; missingRoot?: boolean };
        if (!httpOk || !payload.ok) {
          if (payload.missingRoot === true) {
            setSnapshot((prev) => ({ ...(prev.root === root ? prev : emptySnapshot(root)), missingRoot: true }));
          }
          return;
        }
        const next = payload.files ?? [];
        setSnapshot((prev) => {
          const base = prev.root === root ? prev : emptySnapshot(root);
          return {
            ...base,
            // Content-guard: an unchanged poll keeps the previous array
            // reference so the tree and the rail do not re-render every five
            // seconds while an agent is mid-edit.
            files: arrayContentEqual(base.files, next) ? base.files : next,
            repoRoot: payload.repoRoot ?? null,
            ok: true,
            missingRoot: false,
          };
        });
      } catch {
        /* keep the last known summary — a transient failure is not "clean" */
      } finally {
        if (ledger.accepts(ticket)) {
          setSnapshot((prev) =>
            prev.root === root ? (prev.loaded ? prev : { ...prev, loaded: true }) : { ...emptySnapshot(root), loaded: true },
          );
        }
        reload = ledger.end(ticket).reload;
      }
      if (reload) void loadRef.current();
    },
    [ledger, projectRoot],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    // A new root is a new generation: nothing in flight or queued is its.
    ledger.newGeneration();
    setSnapshot((prev) => (prev.root === projectRoot ? prev : emptySnapshot(projectRoot)));
    // Shared on mount (#5745): the changes panel and the viewer's launchpad
    // read the same list at the same moment, and one request answers all.
    void load({ shared: true });
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
  }, [ledger, load, projectRoot]);

  // Shared, so the changes panel's own poll joins the same request. The
  // helper skips a hidden page, and reads again when the window regains
  // focus (#5795): switching apps on the desktop fires no visibilitychange.
  usePausablePoll(() => load({ shared: true }), running ? POLL_MS : CHANGES_IDLE_POLL_MS);

  let additions = 0;
  let deletions = 0;
  for (const file of view.files) {
    additions += file.insertions ?? 0;
    deletions += file.deletions ?? 0;
  }

  return {
    files: view.files,
    repoRoot: view.repoRoot,
    additions,
    deletions,
    loaded: view.loaded,
    ok: view.ok,
    missingRoot: view.missingRoot,
    refresh: () => void load(),
  };
}
