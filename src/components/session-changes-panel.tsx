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
import { checkpointLabel } from "@/lib/session-changes-format";
import { changesOutbound, EMPTY_CHANGES_OUTBOUND, type ChangesOutbound } from "@/lib/changes-outbound-drafts";
import {
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
import { ChangesSkeleton, CheckpointSection, FileRow } from "./session-changes-rows";

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
  const [committing, setCommitting] = useState(false);
  const { announce } = useAnnouncer();
  // Set after a successful commit so the "Create PR" affordance persists even
  // though the file list is now empty.
  const postCommit = outbound.postCommit;
  const setPostCommit = useCallback((next: ChangesOutbound["postCommit"]) => setOutbound({ postCommit: next }), [setOutbound]);
  const prOpen = outbound.prOpen;
  const setPrOpen = useCallback((next: boolean) => setOutbound({ prOpen: next }), [setOutbound]);
  const prTitle = outbound.prTitle;
  const setPrTitle = useCallback((next: string) => setOutbound({ prTitle: next }), [setOutbound]);
  const prBody = outbound.prBody;
  const setPrBody = useCallback((next: string) => setOutbound({ prBody: next }), [setOutbound]);
  const [creatingPr, setCreatingPr] = useState(false);
  const prUrl = outbound.prUrl;
  const setPrUrl = useCallback((next: string | null) => setOutbound({ prUrl: next }), [setOutbound]);

  // Default is a FORCED fetch through the shared changes-summary gate
  // (cave-v8hh): the visibility/`cave:changes-refresh`/post-mutation callers
  // all follow a state change and must not reuse a cached response. The 5s
  // running poll and the mount pass shared:true. A mount follows no change of
  // its own, and forcing it made every session switch fetch the same list
  // once for the desk and again for this panel (#5745).
  const load = useCallback(async (opts?: { shared?: boolean }) => {
    if (inFlightRef.current) return;
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
    }
  }, [projectRoot]);

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
        await mutateSessionChanges(fetch, projectRoot, "restore-checkpoint", { checkpoint: name });
        setCheckpointMessage(`Restored checkpoint ${checkpointLabel(name)}.`);
        setDiffs({});
        await load();
      } catch (err) {
        setActionError({ action: "Couldn't restore the checkpoint", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusyCheckpoint(null);
      }
    },
    [projectRoot, load],
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

  const revertFile = useCallback(
    async (file: ChangedFile) => {
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
      }
    },
    [load, loadCheckpoints, projectRoot],
  );

  const commitChanges = useCallback(async () => {
    const message = commitMsg.trim();
    if (!message) return;
    setCommitting(true);
    setActionError(null);
    setPrUrl(null);
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
      });
      announce("Changes committed.");
      setDiffs({});
      setExpandedPath(null);
      await Promise.all([load(), loadCheckpoints()]);
    } catch (err) {
      setActionError({ action: "Couldn't commit", message: err instanceof Error ? err.message : String(err) });
      // A refused commit usually means the tree moved: show the new list.
      void load();
    } finally {
      setCommitting(false);
    }
  }, [announce, commitMsg, files, projectRoot, load, loadCheckpoints, setOutbound]);

  const createPr = useCallback(async () => {
    const title = prTitle.trim();
    if (!title) return;
    setCreatingPr(true);
    setActionError(null);
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
      setOutbound({ prUrl: json.url ?? null, prOpen: false, postCommit: null });
      if (json.url) announce("Pull request opened.");
    } catch (err) {
      setActionError({ action: "Couldn't create the pull request", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreatingPr(false);
    }
  }, [announce, postCommit, prTitle, prBody, projectRoot, setOutbound]);

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
  const cursorPath =
    gridCursor && files.some((file) => file.path === gridCursor.path) ? gridCursor.path : files[0]?.path ?? null;
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
    <div className="flex h-full min-h-0 flex-col">
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
              <span className="min-w-0 truncate" title={error}>
                {error}
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

        {actionError && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--color-danger)]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate" title={`${actionError.action}: ${actionError.message}`}>
                {actionError.action}: {actionError.message}
              </span>
            </span>
            <IconButton
              icon="ph:x-bold"
              size="xs"
              className="shrink-0"
              aria-label="Dismiss error"
              onClick={() => setActionError(null)}
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
                  onClick={() => setPostCommit(null)}
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

          {prOpen ? (
            <div className="space-y-1.5 rounded-md border border-[var(--border-hairline)] p-2">
              <input
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="Pull request title"
                aria-label="Pull request title"
                className="focus-ring w-full rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              />
              <textarea
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                placeholder="Description (optional)"
                aria-label="Pull request description"
                rows={3}
                className="focus-ring w-full resize-y rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="xs"
                  leadingIcon="ph:git-pull-request"
                  disabled={!prTitle.trim() || creatingPr}
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

          {!postCommit && !prOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commitChanges();
                }}
                placeholder={canCommit ? "Commit message" : "No changes to commit"}
                aria-label="Commit message"
                disabled={!canCommit || committing}
                className="focus-ring min-w-0 flex-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)] disabled:opacity-40"
              />
              <Button
                variant="primary"
                size="xs"
                leadingIcon="ph:git-diff"
                disabled={!canCommit || !commitMsg.trim() || committing}
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
