"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/lib/icon";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useChatDebugSnapshot } from "@/lib/chat-debug-store";
import { openExternalUrl } from "@/lib/open-external";
import { useAnnouncer } from "@/components/ui/live-region";
import { buildChangesReviewPrompt } from "@/lib/changes-review";
import { checkpointLabel, checkpointRestoreMessage, type CheckpointRestoreResult } from "@/lib/session-changes-format";
import { changesOutbound, EMPTY_CHANGES_OUTBOUND, type ChangesOutbound } from "@/lib/changes-outbound-drafts";
import {
  ChangesRequestError,
  fetchSessionCheckpoints,
  fetchSessionFileDiff,
  mutateSessionChanges,
  type ChangedFile,
  type CheckpointMeta,
  type DiffState,
} from "@/lib/session-changes-api";
import { isCodeRailFileViewed, type CodeRailViewedState,
  codeRailShapeOf,
} from "@/lib/code-side-rail";
import { ChangesSkeleton, CheckpointSection, FileRow, confirmRowKey } from "./session-changes-rows";

/**
 * "Changes" right-panel tab (CHAT-D8-01): a per-session review surface for the
 * working tree the agent is mutating. Lists uncommitted changes under the
 * session's project root with per-file diff preview and per-file revert.
 *
 * Honest scoping: git can't attribute a change to this session specifically,
 * so the panel shows ALL uncommitted changes in the repo and says so.
 */

const POLL_MS = 5000;

type ChangesResponse = {
  ok?: boolean;
  repo?: boolean;
  repoRoot?: string;
  files?: ChangedFile[];
  error?: string;
};


// ── Panel body (mounted per project root) ─────────────────────────────────────

/** What a cached diff was read for: the file's status, line counts and change
 *  stamp. A rewrite that keeps the counts still moves the stamp (#5745). */
function diffSignature(file: ChangedFile | undefined): string {
  if (!file) return "";
  return `${file.status}:${file.insertions ?? 0}:${file.deletions ?? 0}:${file.changeVersion ?? ""}`;
}

export function SessionChangesInner({
  projectRoot,
  running,
  focusPath,
  focusNonce,
  viewed,
  onToggleViewed,
  onFilesChange,
  draftKey,
}: {
  projectRoot: string;
  running: boolean;
  /** Expand a specific file's diff (e.g. jumped to from a transcript edit
   *  tool). `focusNonce` re-triggers the jump even when the same path repeats. */
  focusPath?: string | null;
  focusNonce?: number;
  /**
   * Per-file review state, owned by the Coding Desk's rail (cave-0rcku). Both
   * props are required together to light the Viewed column; the chat panel
   * passes neither and renders exactly as before.
   */
  viewed?: CodeRailViewedState;
  onToggleViewed?: (file: ChangedFile) => void;
  /** Report the live file list up so a host can compare snapshots.
   *  It is `null` until the first successful load and again on unmount: an
   *  initial `[]` or a failed request is not a snapshot of the worktree. */
  onFilesChange?: (files: ChangedFile[] | null) => void;
  /** Where the commit message, Create PR and PR draft are kept between mounts
   *  (#5745). The Coding Desk keys by session; defaults to the project root. */
  draftKey?: string;
}) {
  const reviewable = Boolean(viewed && onToggleViewed);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [notARepo, setNotARepo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which action failed, and why (#5729): every failure used to read
  // "revert: …", including a rejected commit or a failed checkpoint.
  const [actionError, setActionError] = useState<{ action: string; message: string } | null>(null);
  const [checkpointing, setCheckpointing] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [revertingPath, setRevertingPath] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [busyCheckpoint, setBusyCheckpoint] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Commit + Create PR flow. The drafts and the post-commit "Create PR" live
  // in a store, not here (#5745): this panel unmounts off its rail tab, on the
  // narrow steps and behind the PR reader, and with it went a half-typed
  // message, or the only way to open the PR for a commit just made.
  const outboundKey = draftKey ?? projectRoot;
  const outbound = useSyncExternalStore(
    changesOutbound.subscribe,
    () => changesOutbound.get(outboundKey),
    () => EMPTY_CHANGES_OUTBOUND,
  );
  const setOutbound = useCallback(
    (change: Partial<ChangesOutbound>) => changesOutbound.patch(outboundKey, change),
    [outboundKey],
  );
  const commitMsg = outbound.commitMessage;
  const setCommitMsg = useCallback((commitMessage: string) => setOutbound({ commitMessage }), [setOutbound]);
  // In flight in the store, not here (#5756): a tab change mid-commit used
  // to re-enable Commit and lose the request's failure.
  const committing = outbound.pending === "commit";
  const { announce } = useAnnouncer();
  // Set after a successful commit so the "Create PR" affordance persists even
  // though the file list is now empty.
  const postCommit = outbound.postCommit;
  const prOpen = outbound.prOpen;
  const setPrOpen = useCallback((next: boolean) => setOutbound({ prOpen: next }), [setOutbound]);
  const prTitle = outbound.prTitle;
  const setPrTitle = useCallback((next: string) => setOutbound({ prTitle: next }), [setOutbound]);
  const prBody = outbound.prBody;
  const setPrBody = useCallback((next: string) => setOutbound({ prBody: next }), [setOutbound]);
  const creatingPr = outbound.pending === "create-pr";
  // One request at a time (#5775 review): a Create PR sent while a second
  // commit ran, or the reverse, overwrote the other's state and its pin.
  const requestPending = outbound.pending !== null;
  // A commit's or Create PR's failure is kept with the draft (#5756); the
  // panel's own actions report here directly.
  const shownError = actionError ?? outbound.error;
  const prUrl = outbound.prUrl;

  // Default is a FORCED fetch through the shared changes-summary gate
  // (cave-v8hh): the visibility/`cave:changes-refresh`/post-mutation callers
  // all follow a state change and must not reuse a cached response. The 5s
  // running poll and the mount pass shared:true. A mount follows no change of
  // its own, and forcing it made every session switch fetch the same list
  // once for the desk and again for this panel (#5745).
  //
  // A forced load that arrives while one is in flight runs right after it
  // (#5756). Returning dropped the refresh a save, a branch switch or a commit
  // asked for, and an idle session's list stayed stale, so the next commit
  // met a spurious "working tree changed".
  const queuedLoadRef = useRef(false);
  const loadAgainRef = useRef<() => void>(() => {});
  const load = useCallback(async (opts?: { shared?: boolean }) => {
    if (inFlightRef.current) {
      if (!opts?.shared) queuedLoadRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const { httpOk, status, json: raw } = await fetchChangesSummary(projectRoot, {
        force: !opts?.shared,
      });
      const json = raw as ChangesResponse;
      if (!httpOk || !json.ok) throw new Error(json.error ?? `http ${status}`);
      setNotARepo(json.repo === false);
      setRepoRoot(json.repoRoot ?? null);
      // Content-guard: an unchanged 5s poll keeps the previous reference so the
      // whole diff panel (and the expanded file's diff refetch, gated by
      // filesSig) doesn't churn while an agent is actively editing.
      const nextFiles = json.files ?? [];
      setFiles((prev) => (arrayContentEqual(prev, nextFiles) ? prev : nextFiles));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      setLoaded(true);
      if (queuedLoadRef.current) {
        queuedLoadRef.current = false;
        loadAgainRef.current();
      }
    }
  }, [projectRoot]);
  loadAgainRef.current = () => void load();

  // Let a host (the Coding Desk) compare this panel's snapshot with its own.
  // Only a SUCCESSFUL load is a snapshot: the initial `[]` before the first
  // response, or the list left after a failed refresh, would read as a
  // disagreement and trigger needless refetches (#5729). Unmounting reports
  // `null` so the host never compares against a list nobody is showing.
  const onFilesChangeRef = useRef(onFilesChange);
  onFilesChangeRef.current = onFilesChange;
  useEffect(() => {
    if (!loaded || error) return;
    onFilesChangeRef.current?.(files);
  }, [error, files, loaded]);
  useEffect(() => () => onFilesChangeRef.current?.(null), []);

  const loadCheckpoints = useCallback(async () => {
    try {
      setCheckpoints(await fetchSessionCheckpoints(fetch, projectRoot));
    } catch {
      /* checkpoint list is auxiliary — don't surface as a panel error */
    }
  }, [projectRoot]);

  // Load when the panel becomes visible: on mount (the tab mounts the panel)
  // and when the document regains visibility. No polling while hidden — the
  // interval below only ticks for visible documents on a running session.
  useEffect(() => {
    void load({ shared: true });
    void loadCheckpoints();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
        void loadCheckpoints();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, loadCheckpoints]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ shared: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, running]);

  // An inline "Undo" on a transcript edit card reverts a file via /api/changes
  // and fires `cave:changes-refresh` so this panel reflects the reverted file
  // (and the fresh checkpoint) without waiting for the poll — mirroring the
  // load()+loadCheckpoints() refresh that revertFile does after its own revert.
  useEffect(() => {
    const onRefresh = () => {
      void load();
      void loadCheckpoints();
    };
    window.addEventListener("cave:changes-refresh", onRefresh);
    return () => window.removeEventListener("cave:changes-refresh", onRefresh);
  }, [load, loadCheckpoints]);

  const diffRequestsRef = useRef(new Map<string, number>());
  const fetchDiff = useCallback(
    // `silent` re-fetches without flashing the "Loading diff…" state or wiping
    // the visible diff on error — used by the poll refresh so an open diff for
    // an actively-changing file stays current instead of going stale.
    async (filePath: string, silent = false, sig?: string) => {
      // Reads of one path can answer out of order; only the newest may land
      // (#5751 review), or an older diff overwrites a newer one for good.
      const request = (diffRequestsRef.current.get(filePath) ?? 0) + 1;
      diffRequestsRef.current.set(filePath, request);
      if (!silent) setDiffs((prev) => ({ ...prev, [filePath]: { loading: true } }));
      try {
        const json = await fetchSessionFileDiff(fetch, projectRoot, filePath);
        if (diffRequestsRef.current.get(filePath) !== request) return;
        setDiffs((prev) => ({
          ...prev,
          [filePath]: { loading: false, diff: json.diff, truncated: json.truncated, sig },
        }));
      } catch (err) {
        if (diffRequestsRef.current.get(filePath) !== request) return;
        if (silent) return; // keep the last good diff on a background refresh
        setDiffs((prev) => ({
          ...prev,
          [filePath]: { loading: false, error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [projectRoot],
  );

  // #4: when the file list refreshes (poll/visibility), re-fetch the currently
  // expanded file's diff so it doesn't show a frozen snapshot. Keyed on a
  // signature of the list so it only fires when something actually changed.
  // The full version stamp, not just the counts (#5751 review): a rewrite that
  // keeps the line counts must still refresh the expanded diff.
  const filesSig = files.map((f) => `${f.path}:${diffSignature(f)}`).join("|");
  // Aggregate +/- across all changed files for the header summary.
  const totalInsertions = files.reduce((sum, f) => sum + (f.insertions ?? 0), 0);
  const totalDeletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  useEffect(() => {
    if (!expandedPath) return;
    const file = files.find((f) => f.path === expandedPath);
    if (!file) return;
    void fetchDiff(expandedPath, true, diffSignature(file));
    // expandedPath/files/fetchDiff intentionally omitted: refetch is driven by
    // list-content changes (filesSig), not by expand/collapse (toggleFile owns that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesSig]);

  // A cached diff is shown only for the version it was read for (#5745):
  // expanding a file that changed while collapsed reads it again, so Viewed
  // can never be ticked against a diff the reader did not see.
  const diffIsCurrent = useCallback(
    (file: ChangedFile) => {
      const cached = diffs[file.path];
      return Boolean(cached && (cached.loading || cached.sig === diffSignature(file)));
    },
    [diffs],
  );
  const toggleFile = useCallback(
    (file: ChangedFile) => {
      setExpandedPath((prev) => (prev === file.path ? null : file.path));
      if (expandedPath !== file.path && !diffIsCurrent(file)) void fetchDiff(file.path, false, diffSignature(file));
    },
    [diffIsCurrent, expandedPath, fetchDiff],
  );

  // Jump-to-diff: when a transcript edit tool is clicked, expand that file's
  // diff. The changes list is repo-relative while focusPath may be absolute (or
  // vice versa), so match on exact path or a /-boundary suffix (a bare string
  // suffix would let `utils/foo.ts` match a sibling `s/foo.ts`). Keyed on
  // focusNonce + the file list so it retries once the just-edited file appears
  // in the diff list — but each nonce applies exactly ONCE: filesSig churns on
  // every 5s poll while an agent is editing (+/- counts change), and without
  // the consumed guard the stale focus re-expanded its file on every refresh,
  // snapping the panel away from whichever diff the user had selected.
  const appliedFocusNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusPath || focusNonce === undefined) return;
    if (appliedFocusNonceRef.current === focusNonce) return;
    const suffixMatch = (long: string, short: string) =>
      long === short || long.endsWith(`/${short}`);
    const match = files.find(
      (f) => suffixMatch(focusPath, f.path) || suffixMatch(f.path, focusPath),
    );
    if (!match) return;
    appliedFocusNonceRef.current = focusNonce;
    setExpandedPath(match.path);
    if (!diffIsCurrent(match)) void fetchDiff(match.path, false, diffSignature(match));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusPath, filesSig]);

  const saveCheckpoint = useCallback(async () => {
    setCheckpointing(true);
    setActionError(null);
    setCheckpointMessage(null);
    try {
      await mutateSessionChanges<{
        ok?: boolean;
        checkpointPath?: string;
        error?: string;
      }>(fetch, projectRoot, "checkpoint");
      setCheckpointMessage("Checkpoint saved.");
      setCheckpointsOpen(true);
      void loadCheckpoints();
    } catch (err) {
      setActionError({ action: "Couldn't save a checkpoint", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCheckpointing(false);
    }
  }, [projectRoot, loadCheckpoints]);

  const restoreCheckpoint = useCallback(
    async (name: string) => {
      setBusyCheckpoint(name);
      setActionError(null);
      setCheckpointMessage(null);
      try {
        const result = await mutateSessionChanges<{ ok?: boolean; error?: string } & CheckpointRestoreResult>(
          fetch,
          projectRoot,
          "restore-checkpoint",
          { checkpoint: name },
        );
        const message = checkpointRestoreMessage(checkpointLabel(name), result);
        setCheckpointMessage(message);
        announce(message);
        setDiffs({});
        // A restore that wrote anything saved the state before it first.
        await Promise.all([load(), loadCheckpoints()]);
      } catch (err) {
        setActionError({ action: "Couldn't restore the checkpoint", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusyCheckpoint(null);
      }
    },
    [announce, projectRoot, load, loadCheckpoints],
  );

  const deleteCheckpoint = useCallback(
    async (name: string) => {
      setBusyCheckpoint(name);
      setActionError(null);
      try {
        await mutateSessionChanges(fetch, projectRoot, "delete-checkpoint", { checkpoint: name });
        await loadCheckpoints();
      } catch (err) {
        setActionError({ action: "Couldn't delete the checkpoint", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusyCheckpoint(null);
      }
    },
    [projectRoot, loadCheckpoints],
  );

  // Where focus goes once a revert settles (#5756). Confirm unmounts the
  // focused button, so focus fell to the page: back to the row's Revert when
  // it's still there (the revert failed), else to the row that took its
  // place, else to the panel's first control. Only when focus fell to the
  // page (#5778 review): a person who moved on meanwhile, in the panel or
  // anywhere else, keeps their place. It runs from an effect, after the
  // commit that re-enables Revert (#5779): a frame queued in `finally` could
  // fire first, while Revert was still disabled, and the focus call failed.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const gridBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [revertFocus, setRevertFocus] = useState<{ path: string; index: number } | null>(null);
  const restoreFocusAfterRevert = useCallback((path: string, index: number) => {
    const panel = panelRef.current;
    const active = document.activeElement;
    if (!panel || (active && active !== document.body)) return;
    const rows = [...(gridBodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-grid-row]") ?? [])]
      .filter((row) => !(row.dataset.gridRow ?? "").includes("\u0000"));
    const same = rows.find((row) => row.dataset.gridRow === path);
    const target = same
      ? same.querySelector<HTMLElement>("[data-revert-control]")
      : rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>('[data-grid-col="0"]');
    (target ?? panel.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
  }, []);
  useEffect(() => {
    if (revertFocus) restoreFocusAfterRevert(revertFocus.path, revertFocus.index);
  }, [revertFocus, restoreFocusAfterRevert]);

  const revertFile = useCallback(
    async (file: ChangedFile) => {
      const index = files.findIndex((entry) => entry.path === file.path);
      setRevertingPath(file.path);
      setActionError(null);
      try {
        const json = await mutateSessionChanges<{
          ok?: boolean;
          error?: string;
          checkpointPath?: string;
        }>(fetch, projectRoot, "revert", {
          path: file.path,
          // New files (untracked or staged-new) are deleted on revert; the
          // confirm step the user just clicked through is the explicit
          // consent for that.
          confirmUntracked: file.status === "untracked" || file.status === "added",
        });
        setDiffs((prev) => {
          const next = { ...prev };
          delete next[file.path];
          return next;
        });
        setExpandedPath((prev) => (prev === file.path ? null : prev));
        // Reverts auto-snapshot first — tell the user it's recoverable and
        // refresh the checkpoint list so the new snapshot shows up.
        if (json.checkpointPath) {
          setCheckpointMessage("Reverted — a checkpoint was saved first, so you can undo it below.");
          announce("File reverted — a checkpoint was saved first.");
        }
        await Promise.all([load(), loadCheckpoints()]);
      } catch (err) {
        setActionError({ action: "Couldn't revert the file", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setRevertingPath(null);
        setRevertFocus({ path: file.path, index: Math.max(0, index) });
      }
    },
    [files, load, loadCheckpoints, projectRoot],
  );

  const commitChanges = useCallback(async () => {
    const message = commitMsg.trim();
    if (!message || changesOutbound.get(outboundKey).pending) return;
    setActionError(null);
    setOutbound({ pending: "commit", error: null, prUrl: null });
    try {
      const json = await mutateSessionChanges<{
        ok?: boolean; sha?: string; headOid?: string; branch?: string; onDefaultBranch?: boolean; error?: string;
      }>(fetch, projectRoot, "commit", {
        message,
        // The list as reviewed (#5745): the server refuses when the working
        // tree no longer matches it, so nothing is committed unseen.
        expectedChanges: files.map((file) => ({ path: file.path, changeVersion: file.changeVersion ?? "" })),
      });
      setOutbound({
        postCommit: {
          sha: json.sha ?? "",
          headOid: json.headOid ?? "",
          branch: json.branch ?? "",
          onDefaultBranch: json.onDefaultBranch === true,
        },
        prTitle: message.split("\n")[0].slice(0, 72),
        prBody: "",
        prOpen: false,
        commitMessage: "",
        pending: null,
      });
      announce("Changes committed.");
      setDiffs({});
      setExpandedPath(null);
      await Promise.all([load(), loadCheckpoints()]);
    } catch (err) {
      setOutbound({ pending: null, error: { action: "Couldn't commit", message: err instanceof Error ? err.message : String(err) } });
      // A refused commit usually means the tree moved: show the new list.
      void load();
    }
  }, [announce, commitMsg, files, projectRoot, load, loadCheckpoints, outboundKey, setOutbound]);

  const createPr = useCallback(async () => {
    const title = prTitle.trim();
    // Only ever the commit made here (#5756): the PR is pinned to it, and
    // without it there is nothing reviewed to open a PR for.
    if (!title || !postCommit || changesOutbound.get(outboundKey).pending) return;
    setActionError(null);
    setOutbound({ pending: "create-pr", error: null });
    try {
      const json = await mutateSessionChanges<{ ok?: boolean; url?: string; error?: string }>(
        fetch,
        projectRoot,
        "create-pr",
        {
          title,
          prBody,
          // Pinned to the commit made here (#5745): the server refuses when
          // the branch moved or gained commits since.
          ...(postCommit?.headOid ? { expectedHead: postCommit.headOid } : {}),
          ...(postCommit?.branch ? { expectedBranch: postCommit.branch } : {}),
        },
      );
      setOutbound({ prUrl: json.url ?? null, prOpen: false, postCommit: null, pending: null });
      if (json.url) announce("Pull request opened.");
    } catch (err) {
      const error = { action: "Couldn't create the pull request", message: err instanceof Error ? err.message : String(err) };
      if (err instanceof ChangesRequestError && err.stale) {
        // The branch moved past the reviewed commit (#5756). Retrying can
        // only be refused again, so the pin and the form go, and the list
        // shows what changed.
        setOutbound({ pending: null, error, postCommit: null, prOpen: false });
        void load();
      } else {
        setOutbound({ pending: null, error });
      }
    }
  }, [announce, load, outboundKey, postCommit, prTitle, prBody, projectRoot, setOutbound]);

  const canCommit = loaded && !notARepo && !error && files.length > 0;

  // Stable row callbacks, so the memoized rows re-render only when their own
  // props change (#5745).
  const toggleFileRef = useRef(toggleFile);
  toggleFileRef.current = toggleFile;
  const revertFileRef = useRef(revertFile);
  revertFileRef.current = revertFile;
  const onToggleRow = useCallback((file: ChangedFile) => toggleFileRef.current(file), []);
  const onRevertRow = useCallback((file: ChangedFile) => void revertFileRef.current(file), []);

  // The table is a grid with one tab stop (#5745): at 400 files its three
  // controls a row were 1,200 Tab presses between the rail and the composer.
  // Arrow keys move between rows and cells; the cell last used keeps the stop.
  const [gridCursor, setGridCursor] = useState<{ path: string; col: number } | null>(null);
  // The cursor names a grid row: a file's row, or its revert confirmation.
  const cursorPath =
    gridCursor && files.some((file) => file.path === gridCursor.path || confirmRowKey(file.path) === gridCursor.path)
      ? gridCursor.path
      : files[0]?.path ?? null;
  const cursorCol = gridCursor && cursorPath === gridCursor.path ? gridCursor.col : 0;
  const onGridFocus = useCallback((event: React.FocusEvent<HTMLTableSectionElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-grid-col]");
    const row = cell?.closest<HTMLElement>("tr[data-grid-row]");
    if (!cell || !row) return;
    const path = row.dataset.gridRow ?? "";
    const col = Number(cell.dataset.gridCol);
    setGridCursor((prev) => (prev && prev.path === path && prev.col === col ? prev : { path, col }));
  }, []);
  const onGridKeyDown = useCallback((event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-grid-col]");
    const row = cell?.closest<HTMLElement>("tr[data-grid-row]");
    if (!cell || !row) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("tr[data-grid-row]"));
    let rowIndex = rows.indexOf(row);
    let col = Number(cell.dataset.gridCol);
    if (event.key === "ArrowDown") rowIndex = Math.min(rows.length - 1, rowIndex + 1);
    else if (event.key === "ArrowUp") rowIndex = Math.max(0, rowIndex - 1);
    else if (event.key === "ArrowRight") col += 1;
    else if (event.key === "ArrowLeft") col -= 1;
    else if (event.key === "Home") col = 0;
    else if (event.key === "End") col = Number.MAX_SAFE_INTEGER;
    else if (event.key === "PageDown") rowIndex = rows.length - 1;
    else if (event.key === "PageUp") rowIndex = 0;
    else return;
    event.preventDefault();
    const cells = Array.from(rows[rowIndex].querySelectorAll<HTMLElement>("[data-grid-col]"));
    if (!cells.length) return;
    const target = cells[Math.max(0, Math.min(cells.length - 1, col))];
    target.focus();
  }, []);

  // Commit review — start a NEW chat session whose opening prompt reviews the
  // working-tree changes. Dispatched through the cave:agents-new-chat bridge:
  // the Workspace opens the chat when this panel lives on a non-chat surface
  // (the Code view), and ChatSurface handles it directly when already in chat.
  const startReviewSession = useCallback(() => {
    const root = repoRoot ?? projectRoot;
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: {
          projectRoot: root,
          initialPrompt: buildChangesReviewPrompt({ repoRoot: root, files }),
        },
      }),
    );
    announce("Review session started on the working-tree changes.");
  }, [repoRoot, projectRoot, files, announce]);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col">
      {/* Header: honest scope copy + refresh */}
      <div className="session-changes-panel__toolbar shrink-0 border-b border-[var(--border-hairline)] px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Worktree
              </span>
              {loaded && !notARepo && !error ? (
                <span className="inline-flex h-4 shrink-0 items-center rounded border border-[var(--border-hairline)] px-1.5 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  {files.length}
                </span>
              ) : null}
              {loaded && !notARepo && !error && totalInsertions + totalDeletions > 0 ? (
                <span className="min-w-0 truncate font-mono text-[length:var(--text-2xs)]">
                  <span className="text-[var(--accent-presence)]">+{totalInsertions}</span>{" "}
                  <span className="text-[var(--color-danger)]">−{totalDeletions}</span>
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={repoRoot ?? projectRoot}>
              {notARepo
                ? <>No git working tree at {repoRoot ?? projectRoot}.</>
                : <>All uncommitted changes in {repoRoot ?? projectRoot} — not only this session&rsquo;s edits.</>}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              size="xs"
              variant="secondary"
              leadingIcon="ph:git-diff"
              className="shrink-0"
              onClick={startReviewSession}
              disabled={!canCommit}
              title="Start a new session that reviews these changes like a commit review"
              aria-label="Review changes in a new session"
            >
              Review
            </Button>
            <IconButton
              icon="ph:archive"
              size="sm"
              className="shrink-0"
              onClick={() => void saveCheckpoint()}
              disabled={checkpointing || notARepo || !!error}
              title="Save patch checkpoint"
              aria-label="Save patch checkpoint"
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              title="Refresh"
              aria-label="Refresh working tree changes"
              className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <Icon name="ph:arrows-clockwise" width={11} aria-hidden className={refreshing ? "animate-spin" : undefined} />
              <span className="sr-only">Refresh</span>
            </button>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* Load failure: icon + truncating message + Retry, per the shared idiom */}
        {error && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--color-danger)]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0" />
              {/* Says what failed (#5756): a bare "Failed to fetch" didn't. */}
              <span className="min-w-0 truncate" title={`Couldn't load changes: ${error}`}>
                Couldn&apos;t load changes: {error}
              </span>
            </span>
            <button
              type="button"
              className="focus-ring shrink-0 underline"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        )}

        {/* Transient action failures are dismissable */}
        {checkpointMessage && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--accent-presence)]">
            <span className="min-w-0 truncate" title={checkpointMessage}>{checkpointMessage}</span>
            <IconButton
              icon="ph:x-bold"
              size="xs"
              className="shrink-0"
              aria-label="Dismiss checkpoint message"
              onClick={() => setCheckpointMessage(null)}
            />
          </div>
        )}

        {shownError && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--color-danger)]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate" title={`${shownError.action}: ${shownError.message}`}>
                {shownError.action}: {shownError.message}
              </span>
            </span>
            <IconButton
              icon="ph:x-bold"
              size="xs"
              className="shrink-0"
              aria-label="Dismiss error"
              onClick={() => {
                setActionError(null);
                setOutbound({ error: null });
              }}
            />
          </div>
        )}

        {!loaded && !error ? (
          <ChangesSkeleton />
        ) : notARepo ? (
          <div className="px-2 py-6 text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
            <p className="font-medium text-[var(--text-secondary)]">Not a git repository.</p>
            <p className="mt-1">
              This session&rsquo;s project root isn&rsquo;t under git, so there&rsquo;s no working
              tree to review.
            </p>
          </div>
        ) : error && files.length === 0 ? (
          // A failed first load has no list to show; the error banner above
          // carries the reason and Retry. An empty table under it read as
          // "nothing changed" (#5729).
          null
        ) : loaded && !error && files.length === 0 ? (
          <div className="px-2 py-6 text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
            <p className="font-medium text-[var(--text-secondary)]">No uncommitted changes.</p>
            <p className="mt-1">Edits the agent makes to this project will show up here.</p>
          </div>
        ) : (
          <div className="session-changes-table-wrap overflow-hidden rounded-md border border-[var(--border-hairline)]">
            <table
              className="session-changes-table w-full table-fixed border-collapse text-[length:var(--text-xs)]"
              role="grid"
              aria-label="Changed files"
            >
              <colgroup>
                <col />
                <col className="w-[70px]" />
                {reviewable ? <col className="w-[var(--space-6)]" /> : null}
                <col className="w-[var(--space-8)]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[var(--bg-base)] text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border-hairline)]">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    File
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Diff
                  </th>
                  {reviewable ? (
                    <th scope="col" className="px-1 py-1.5 text-right font-medium">
                      <span className="sr-only">Viewed</span>
                    </th>
                  ) : null}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody
                ref={gridBodyRef}
                className="divide-y divide-[var(--border-hairline)]"
                onKeyDown={onGridKeyDown}
                onFocus={onGridFocus}
              >
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    expanded={expandedPath === file.path}
                    diffState={diffs[file.path]}
                    reverting={revertingPath === file.path}
                    onToggle={onToggleRow}
                    onRevert={onRevertRow}
                    viewed={reviewable ? isCodeRailFileViewed(viewed ?? {}, codeRailShapeOf(file)) : undefined}
                    onToggleViewed={reviewable ? onToggleViewed : undefined}
                    focusCol={file.path === cursorPath ? cursorCol : null}
                    confirmFocusCol={confirmRowKey(file.path) === cursorPath ? cursorCol : null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Checkpoints: saved snapshots (manual + auto-taken before reverts). */}
        {loaded && !notARepo && !error && checkpoints.length > 0 ? (
          <CheckpointSection
            checkpoints={checkpoints}
            open={checkpointsOpen}
            busyName={busyCheckpoint}
            onToggleOpen={() => setCheckpointsOpen((v) => !v)}
            onRestore={(n) => void restoreCheckpoint(n)}
            onDelete={(n) => void deleteCheckpoint(n)}
          />
        ) : null}
      </div>

      {/* Commit + Create PR — the working tree's outbound actions. */}
      {loaded && !notARepo && !error ? (
        <div className="session-changes-panel__commit shrink-0 space-y-1.5 border-t border-[var(--border-hairline)] px-3 py-2">
          {prUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--accent-presence)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name="ph:check-circle" width={12} aria-hidden className="shrink-0" />
                <span className="min-w-0 truncate">Pull request opened.</span>
              </span>
              <button
                type="button"
                className="focus-ring inline-flex shrink-0 items-center gap-1 underline"
                onClick={() => openExternalUrl(prUrl)}
              >
                Open PR <Icon name="ph:arrow-square-out" width={11} aria-hidden />
              </button>
            </div>
          ) : null}

          {postCommit ? (
            <div className="rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--accent-presence)]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon name="ph:check-circle" width={12} aria-hidden className="shrink-0" />
                  <span className="min-w-0 truncate font-mono">
                    {postCommit.sha} · {postCommit.branch}
                  </span>
                </span>
                <IconButton
                  icon="ph:x-bold"
                  size="xs"
                  className="shrink-0"
                  aria-label="Dismiss commit result"
                  // The PR form goes with it (#5756): without the commit it
                  // was pinned to, Create PR would open an unreviewed head.
                  onClick={() => setOutbound({ postCommit: null, prOpen: false })}
                />
              </div>
              {!prOpen && !postCommit.onDefaultBranch ? (
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon="ph:git-pull-request"
                  className="mt-1.5"
                  onClick={() => setPrOpen(true)}
                >
                  Create PR
                </Button>
              ) : null}
            </div>
          ) : null}

          {prOpen && postCommit ? (
            <div className="space-y-1.5 rounded-md border border-[var(--border-hairline)] p-2">
              <input
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                // An example of intent, not the label again (#5756).
                placeholder="Title the pull request…"
                aria-label="Pull request title"
                className="focus-ring w-full rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              />
              <textarea
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                // Optional belongs to the name, not the placeholder (#5756).
                placeholder="What changed, and why…"
                aria-label="Pull request description (optional)"
                rows={3}
                className="focus-ring w-full resize-y rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="xs"
                  leadingIcon="ph:git-pull-request"
                  disabled={!prTitle.trim() || requestPending}
                  onClick={() => void createPr()}
                >
                  {creatingPr ? "Opening…" : "Create pull request"}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setPrOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {/* Beside a commit result too (#5756): more changes can be committed
              without first dismissing the last one. */}
          {!prOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commitChanges();
                }}
                // Intent, not state (#5756): "No changes to commit" was a
                // status line in the placeholder; the list itself says so.
                placeholder="Describe the change…"
                aria-label="Commit message"
                disabled={!canCommit || committing}
                className="focus-ring min-w-0 flex-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)] disabled:opacity-40"
              />
              <Button
                variant="primary"
                size="xs"
                leadingIcon="ph:git-diff"
                disabled={!canCommit || !commitMsg.trim() || requestPending}
                onClick={() => void commitChanges()}
                title="Stage all changes and commit"
                className="shrink-0"
              >
                {committing ? "Committing…" : "Commit"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

/** Resolves the active session's project root the same way DebugPane resolves
 *  its session context: via the chat debug store bridge from ChatView. */
export function SessionChangesPanel({
  focusPath,
  focusNonce,
}: {
  focusPath?: string | null;
  focusNonce?: number;
} = {}) {
  const snapshot = useChatDebugSnapshot();
  const projectRoot = snapshot.session?.project_root ?? null;
  if (!projectRoot) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Open a chat session to review its working tree changes.
      </div>
    );
  }
  // Keyed by root so list/diff/confirm state resets when the session moves.
  return (
    <SessionChangesInner
      key={projectRoot}
      projectRoot={projectRoot}
      running={snapshot.session?.status === "running"}
      focusPath={focusPath}
      focusNonce={focusNonce}
    />
  );
}
