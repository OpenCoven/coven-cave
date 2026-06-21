"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import { SyntaxBlock } from "@/components/message-bubble";
import { useChatDebugSnapshot } from "@/lib/chat-debug-store";

/**
 * "Changes" right-panel tab (CHAT-D8-01): a per-session review surface for the
 * working tree the agent is mutating. Lists uncommitted changes under the
 * session's project root with per-file diff preview and per-file revert.
 *
 * Honest scoping: git can't attribute a change to this session specifically,
 * so the panel shows ALL uncommitted changes in the repo and says so.
 */

const POLL_MS = 5000;

type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

type ChangesResponse = {
  ok?: boolean;
  repo?: boolean;
  repoRoot?: string;
  files?: ChangedFile[];
  error?: string;
};

type DiffState = {
  loading: boolean;
  diff?: string;
  truncated?: boolean;
  error?: string;
};

type CheckpointMeta = { name: string; savedAt: string; bytes: number };

/** "2026-06-13T07-00-33-123Z.patch" → a short, readable local timestamp. */
function checkpointLabel(name: string): string {
  const iso = name.replace(/\.patch$/, "").replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
  const d = new Date(iso);
  // Honor the app's clock + date preferences instead of the raw browser locale.
  return Number.isNaN(d.getTime()) ? name : formatTimestamp(iso, readDateTimePrefs());
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_META: Record<FileStatus, { letter: string; label: string; color: string }> = {
  modified: { letter: "M", label: "modified", color: "var(--color-warning)" },
  added: { letter: "A", label: "added", color: "var(--accent-presence)" },
  deleted: { letter: "D", label: "deleted", color: "var(--color-danger)" },
  renamed: { letter: "R", label: "renamed", color: "var(--text-secondary)" },
  untracked: { letter: "U", label: "untracked", color: "var(--text-muted)" },
};

function StatusChip({ status }: { status: FileStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[9px] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
      }}
    >
      {meta.letter}
    </span>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  expanded,
  diffState,
  reverting,
  onToggle,
  onRevert,
}: {
  file: ChangedFile;
  expanded: boolean;
  diffState: DiffState | undefined;
  reverting: boolean;
  onToggle: () => void;
  onRevert: () => void;
}) {
  // Two-step revert: first click arms an inline Cancel/Revert confirm that
  // replaces the row action; only the explicit confirm commits. "New" files
  // (untracked, or staged-but-never-committed) get delete copy because
  // reverting one deletes it — it has no committed version to restore.
  const [confirmRevert, setConfirmRevert] = useState(false);
  const untracked = file.status === "untracked" || file.status === "added";

  return (
    <div className="rounded-md border border-[var(--border-hairline)]">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded text-left text-[11px]"
          onClick={onToggle}
          aria-expanded={expanded}
          title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
        >
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
          <StatusChip status={file.status} />
          <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-secondary)]">
            {file.path}
          </span>
          {typeof file.insertions === "number" || typeof file.deletions === "number" ? (
            <span className="shrink-0 font-mono text-[10px]">
              <span className="text-[var(--accent-presence)]">+{file.insertions ?? 0}</span>{" "}
              <span className="text-[var(--color-danger)]">−{file.deletions ?? 0}</span>
            </span>
          ) : null}
        </button>

        {confirmRevert ? (
          <span
            className="flex shrink-0 items-center gap-1.5"
            role="group"
            aria-label={untracked ? "Confirm untracked file deletion" : "Confirm file revert"}
          >
            <span className="text-[10px] font-medium text-[var(--color-danger)]">
              {untracked ? "Delete file?" : "Revert file?"}
            </span>
            <button
              type="button"
              onClick={() => setConfirmRevert(false)}
              className="focus-ring rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRevert(false);
                onRevert();
              }}
              disabled={reverting}
              aria-label={untracked ? `Confirm delete ${file.path}` : `Confirm revert ${file.path}`}
              className="focus-ring inline-flex items-center gap-1 rounded border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] disabled:opacity-40"
            >
              <Icon name={untracked ? "ph:trash" : "ph:arrow-counter-clockwise"} width={10} aria-hidden />
              {reverting ? "…" : untracked ? "Delete" : "Revert"}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRevert(true)}
            disabled={reverting}
            title={untracked ? `Delete ${file.path}` : `Revert ${file.path}`}
            aria-label={untracked ? `Delete untracked file ${file.path}` : `Revert ${file.path}`}
            className="focus-ring shrink-0 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[var(--text-muted)] transition-all hover:border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-danger)_14%,transparent)] hover:text-[var(--color-danger)] disabled:opacity-40"
          >
            <Icon name={untracked ? "ph:trash" : "ph:arrow-counter-clockwise"} width={11} aria-hidden />
          </button>
        )}
      </div>

      {expanded ? (
        <div className="border-t border-[var(--border-hairline)] p-2">
          {!diffState || diffState.loading ? (
            <div className="py-1 text-[10px] text-[var(--text-muted)]">Loading diff…</div>
          ) : diffState.error ? (
            <div className="py-1 text-[10px] text-[var(--color-danger)]">diff: {diffState.error}</div>
          ) : !diffState.diff ? (
            <div className="py-1 text-[10px] text-[var(--text-muted)]">
              No textual diff (binary file or staged-only state).
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-auto">
                <SyntaxBlock text={diffState.diff} lang="diff" className="text-[11px]" />
              </div>
              {diffState.truncated ? (
                <div className="pt-1 text-[10px] text-[var(--text-muted)]">
                  Diff truncated at 200KB.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Checkpoints ────────────────────────────────────────────────────────────────

function CheckpointRow({
  cp,
  busy,
  onRestore,
  onDelete,
}: {
  cp: CheckpointMeta;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  // Restore mutates the working tree, so it gets the same two-step confirm as
  // revert. Delete is non-destructive to the worktree (drops a snapshot), so
  // it's a single click.
  const [confirmRestore, setConfirmRestore] = useState(false);
  const label = checkpointLabel(cp.name);
  const btn =
    "focus-ring shrink-0 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40";

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border-hairline)] px-2 py-1.5">
      <Icon name="ph:archive" width={11} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]" title={cp.name}>
        {label}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{formatBytes(cp.bytes)}</span>
      {confirmRestore ? (
        <span className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Confirm checkpoint restore">
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">Restore?</span>
          <button
            type="button"
            onClick={() => setConfirmRestore(false)}
            className="focus-ring rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmRestore(false);
              onRestore();
            }}
            aria-label={`Confirm restore checkpoint ${label}`}
            className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40"
          >
            <Icon name="ph:arrow-counter-clockwise" width={10} aria-hidden />
            {busy ? "…" : "Restore"}
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmRestore(true)}
            title={`Restore checkpoint ${label}`}
            aria-label={`Restore checkpoint ${label}`}
            className={btn}
          >
            <Icon name="ph:arrow-counter-clockwise" width={11} aria-hidden />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            title={`Delete checkpoint ${label}`}
            aria-label={`Delete checkpoint ${label}`}
            className={btn + " hover:border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] hover:text-[var(--color-danger)]"}
          >
            <Icon name="ph:trash" width={11} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

function CheckpointSection({
  checkpoints,
  open,
  busyName,
  onToggleOpen,
  onRestore,
  onDelete,
}: {
  checkpoints: CheckpointMeta[];
  open: boolean;
  busyName: string | null;
  onToggleOpen: () => void;
  onRestore: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-[var(--border-hairline)] pt-2">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
      >
        <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
        Checkpoints
        <span className="font-mono font-normal normal-case text-[var(--text-muted)]">{checkpoints.length}</span>
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {checkpoints.map((cp) => (
            <CheckpointRow
              key={cp.name}
              cp={cp}
              busy={busyName === cp.name}
              onRestore={() => onRestore(cp.name)}
              onDelete={() => onDelete(cp.name)}
            />
          ))}
          <p className="px-0.5 pt-0.5 text-[10px] text-[var(--text-muted)]">
            Restoring applies a saved snapshot over the working tree (3-way merge).
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── Panel body (mounted per project root) ─────────────────────────────────────

export function SessionChangesInner({
  projectRoot,
  running,
  focusPath,
  focusNonce,
}: {
  projectRoot: string;
  running: boolean;
  /** Expand a specific file's diff (e.g. jumped to from a transcript edit
   *  tool). `focusNonce` re-triggers the jump even when the same path repeats. */
  focusPath?: string | null;
  focusNonce?: number;
}) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [notARepo, setNotARepo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkpointing, setCheckpointing] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [revertingPath, setRevertingPath] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [busyCheckpoint, setBusyCheckpoint] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ChangesResponse;
      if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
      setNotARepo(json.repo === false);
      setRepoRoot(json.repoRoot ?? null);
      setFiles(json.files ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      setLoaded(true);
    }
  }, [projectRoot]);

  const loadCheckpoints = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
        { cache: "no-store" },
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; checkpoints?: CheckpointMeta[] };
      if (json.ok) setCheckpoints(json.checkpoints ?? []);
    } catch {
      /* checkpoint list is auxiliary — don't surface as a panel error */
    }
  }, [projectRoot]);

  // Load when the panel becomes visible: on mount (the tab mounts the panel)
  // and when the document regains visibility. No polling while hidden — the
  // interval below only ticks for visible documents on a running session.
  useEffect(() => {
    void load();
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
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, running]);

  const fetchDiff = useCallback(
    // `silent` re-fetches without flashing the "Loading diff…" state or wiping
    // the visible diff on error — used by the poll refresh so an open diff for
    // an actively-changing file stays current instead of going stale.
    async (filePath: string, silent = false) => {
      if (!silent) setDiffs((prev) => ({ ...prev, [filePath]: { loading: true } }));
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(filePath)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; diff?: string; truncated?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
        setDiffs((prev) => ({
          ...prev,
          [filePath]: { loading: false, diff: json.diff ?? "", truncated: json.truncated },
        }));
      } catch (err) {
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
  const filesSig = files.map((f) => `${f.path}:${f.insertions ?? 0}:${f.deletions ?? 0}`).join("|");
  // Aggregate +/- across all changed files for the header summary.
  const totalInsertions = files.reduce((sum, f) => sum + (f.insertions ?? 0), 0);
  const totalDeletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  useEffect(() => {
    if (!expandedPath) return;
    if (!files.some((f) => f.path === expandedPath)) return;
    void fetchDiff(expandedPath, true);
    // expandedPath/files/fetchDiff intentionally omitted: refetch is driven by
    // list-content changes (filesSig), not by expand/collapse (toggleFile owns that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesSig]);

  const toggleFile = useCallback(
    (file: ChangedFile) => {
      setExpandedPath((prev) => (prev === file.path ? null : file.path));
      if (expandedPath !== file.path && !diffs[file.path]) void fetchDiff(file.path);
    },
    [diffs, expandedPath, fetchDiff],
  );

  // Jump-to-diff: when a transcript edit tool is clicked, expand that file's
  // diff. The changes list is repo-relative while focusPath may be absolute (or
  // vice versa), so match on exact path or suffix. Keyed on focusNonce + the
  // file list so it retries once the just-edited file appears in the diff list.
  useEffect(() => {
    if (!focusPath) return;
    const match = files.find(
      (f) => f.path === focusPath || focusPath.endsWith(f.path) || f.path.endsWith(focusPath),
    );
    if (!match) return;
    setExpandedPath(match.path);
    if (!diffs[match.path]) void fetchDiff(match.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusPath, filesSig]);

  const saveCheckpoint = useCallback(async () => {
    setCheckpointing(true);
    setActionError(null);
    setCheckpointMessage(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectRoot,
          action: "checkpoint",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkpointPath?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
      setCheckpointMessage("Checkpoint saved.");
      setCheckpointsOpen(true);
      void loadCheckpoints();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
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
        const res = await fetch("/api/changes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectRoot, action: "restore-checkpoint", checkpoint: name }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
        setCheckpointMessage(`Restored checkpoint ${checkpointLabel(name)}.`);
        setDiffs({});
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
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
        const res = await fetch("/api/changes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectRoot, action: "delete-checkpoint", checkpoint: name }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
        await loadCheckpoints();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
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
        const res = await fetch("/api/changes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectRoot,
            path: file.path,
            // New files (untracked or staged-new) are deleted on revert; the
            // confirm step the user just clicked through is the explicit
            // consent for that.
            confirmUntracked: file.status === "untracked" || file.status === "added",
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          checkpointPath?: string;
        };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
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
        }
        await Promise.all([load(), loadCheckpoints()]);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setRevertingPath(null);
      }
    },
    [load, loadCheckpoints, projectRoot],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: honest scope copy + refresh */}
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Working tree changes
            {loaded && !notARepo && !error ? (
              <>
                <span className="ml-1.5 font-mono font-normal normal-case text-[var(--text-muted)]">
                  {files.length}
                </span>
                {totalInsertions + totalDeletions > 0 ? (
                  <span className="ml-1.5 font-mono font-normal normal-case">
                    <span className="text-[var(--accent-presence)]">+{totalInsertions}</span>{" "}
                    <span className="text-[var(--color-danger)]">−{totalDeletions}</span>
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void saveCheckpoint()}
              disabled={checkpointing || notARepo || !!error}
              title="Save patch checkpoint"
              aria-label="Save patch checkpoint"
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <Icon name="ph:archive" width={11} aria-hidden />
              {checkpointing ? "Saving" : "Checkpoint"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              title="Refresh"
              aria-label="Refresh working tree changes"
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <Icon name="ph:arrows-clockwise" width={11} aria-hidden className={refreshing ? "animate-spin" : undefined} />
              Refresh
            </button>
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]" title={repoRoot ?? projectRoot}>
          {notARepo
            ? <>No git working tree at {repoRoot ?? projectRoot}.</>
            : <>All uncommitted changes in {repoRoot ?? projectRoot} — not only this session&rsquo;s edits.</>}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* Load failure: icon + truncating message + Retry, per the shared idiom */}
        {error && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-danger)]"
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
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--accent-presence)]">
            <span className="min-w-0 truncate" title={checkpointMessage}>{checkpointMessage}</span>
            <button
              type="button"
              className="focus-ring shrink-0"
              aria-label="Dismiss checkpoint message"
              onClick={() => setCheckpointMessage(null)}
            >
              <Icon name="ph:x-bold" width={10} aria-hidden />
            </button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-danger)]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate" title={actionError}>
                revert: {actionError}
              </span>
            </span>
            <button
              type="button"
              className="focus-ring shrink-0"
              aria-label="Dismiss revert error"
              onClick={() => setActionError(null)}
            >
              <Icon name="ph:x-bold" width={10} aria-hidden />
            </button>
          </div>
        )}

        {!loaded && !error ? (
          <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">Loading changes…</div>
        ) : notARepo ? (
          <div className="px-2 py-6 text-center text-[11px] text-[var(--text-muted)]">
            <p className="font-medium text-[var(--text-secondary)]">Not a git repository.</p>
            <p className="mt-1">
              This session&rsquo;s project root isn&rsquo;t under git, so there&rsquo;s no working
              tree to review.
            </p>
          </div>
        ) : loaded && !error && files.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-[var(--text-muted)]">
            <p className="font-medium text-[var(--text-secondary)]">No uncommitted changes.</p>
            <p className="mt-1">Edits the agent makes to this project will show up here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                expanded={expandedPath === file.path}
                diffState={diffs[file.path]}
                reverting={revertingPath === file.path}
                onToggle={() => toggleFile(file)}
                onRevert={() => void revertFile(file)}
              />
            ))}
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
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

/** Resolves the active session's project root the same way DebugPane resolves
 *  its session context: via the chat debug store bridge from ChatView. */
export function SessionChangesPanel() {
  const snapshot = useChatDebugSnapshot();
  const projectRoot = snapshot.session?.project_root ?? null;
  if (!projectRoot) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-[var(--text-muted)]">
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
    />
  );
}
