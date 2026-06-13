"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
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

// ── Panel body (mounted per project root) ─────────────────────────────────────

function SessionChangesInner({ projectRoot, running }: { projectRoot: string; running: boolean }) {
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

  // Load when the panel becomes visible: on mount (the tab mounts the panel)
  // and when the document regains visibility. No polling while hidden — the
  // interval below only ticks for visible documents on a running session.
  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, running]);

  const fetchDiff = useCallback(
    async (filePath: string) => {
      setDiffs((prev) => ({ ...prev, [filePath]: { loading: true } }));
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
        setDiffs((prev) => ({
          ...prev,
          [filePath]: { loading: false, error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [projectRoot],
  );

  const toggleFile = useCallback(
    (file: ChangedFile) => {
      setExpandedPath((prev) => (prev === file.path ? null : file.path));
      if (expandedPath !== file.path && !diffs[file.path]) void fetchDiff(file.path);
    },
    [diffs, expandedPath, fetchDiff],
  );

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
      setCheckpointMessage(`Saved checkpoint: ${json.checkpointPath ?? "patch saved"}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointing(false);
    }
  }, [projectRoot]);

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
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
        setDiffs((prev) => {
          const next = { ...prev };
          delete next[file.path];
          return next;
        });
        setExpandedPath((prev) => (prev === file.path ? null : prev));
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setRevertingPath(null);
      }
    },
    [load, projectRoot],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: honest scope copy + refresh */}
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Working tree changes
            {loaded && !notARepo && !error ? (
              <span className="ml-1.5 font-mono font-normal normal-case text-[var(--text-muted)]">
                {files.length}
              </span>
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
