"use client";

/**
 * AfsPane — the per-session agent filesystem surface (bead cave-je2q9,
 * upstream coven-gr1), implementing `specs/coven-agent-fs/DESIGN.md` §6:
 * Changes, Timeline, and Commit.
 *
 * Every read goes through Cave's own `/api/afs/*` routes, which proxy the
 * daemon. Nothing here opens a delta or recomputes a diff — the Rust
 * authority boundary is the whole point of the design.
 *
 * Degraded states are first-class rather than afterthoughts: `afs: false`
 * hides the pane outright, `afsMount: false` disables mount controls, and
 * `afsCommit: false` disables commit while showing why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";
import {
  buildChangeTree,
  changeTotal,
  commitAvailability,
  defaultCommitBranch,
  groupTimelineByTurn,
  mergeTimelinePages,
  mountAvailability,
  type AfsCapabilities,
  type AfsChange,
  type AfsCommitPreview,
  type AfsDiff,
  type AfsFileDiff,
  type AfsSession,
  type AfsTimeline,
  type AfsTimelineEntry,
  type AfsTreeNode,
} from "@/lib/afs";

type Overview = {
  ok: boolean;
  capabilities: AfsCapabilities;
  session: AfsSession | null;
  error?: string;
};

type Phase<T> = { phase: "loading" } | { phase: "ready"; data: T } | { phase: "error"; message: string };

const AFS_TABS = ["changes", "timeline", "commit"] as const;
type AfsTab = (typeof AFS_TABS)[number];

const TAB_LABEL: Record<AfsTab, string> = {
  changes: "Changes",
  timeline: "Timeline",
  commit: "Commit",
};

/** Daemon errors arrive as a structured envelope; surface the dotted code. */
function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const { code, message } = error as { code?: string; message?: string };
      if (code && message) return `${code}: ${message}`;
      if (message) return message;
      if (code) return code;
    }
  }
  return fallback;
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(payload, fallback));
  return payload as T;
}

export function AfsPane({ sessionId }: { sessionId: string }) {
  const [overview, setOverview] = useState<Phase<Overview>>({ phase: "loading" });
  const [tab, setTab] = useState<AfsTab>("changes");
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setOverview({ phase: "loading" });
    getJson<Overview>(`/api/afs?sessionId=${encodeURIComponent(sessionId)}`, "Could not read agent filesystem state.")
      .then((data) => {
        if (!cancelled) setOverview({ phase: "ready", data });
      })
      .catch((error: Error) => {
        if (!cancelled) setOverview({ phase: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadToken]);

  if (overview.phase === "loading") {
    return <p className="p-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]">Loading agent filesystem…</p>;
  }
  if (overview.phase === "error") {
    return <PaneError message={overview.message} onRetry={reload} />;
  }

  const { capabilities, session } = overview.data;

  // `afs: false` hides the pane entirely — the daemon has no AFS support at
  // all, so there is nothing to degrade gracefully into.
  if (!capabilities.afs) return null;

  if (!session) {
    return (
      <p className="p-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
        This session has no agent filesystem delta.
      </p>
    );
  }

  return (
    <section aria-label="Agent filesystem" className="flex min-h-0 flex-col gap-2 p-2">
      <div role="tablist" aria-label="Agent filesystem view" className="flex items-center gap-1">
        {AFS_TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={`focus-ring rounded px-2 py-1 text-[length:var(--text-xs)] transition-colors ${
              tab === id
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            onClick={() => setTab(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
        <span className="grow" />
        <MountBadge capabilities={capabilities} />
      </div>

      {tab === "changes" ? <ChangesPane sessionId={session.id} /> : null}
      {tab === "timeline" ? <TimelinePane sessionId={session.id} /> : null}
      {tab === "commit" ? (
        <CommitPane session={session} capabilities={capabilities} onCommitted={reload} />
      ) : null}
    </section>
  );
}

function PaneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 p-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
      <span className="text-[var(--text-danger)]">{message}</span>
      <Button size="sm" variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** Mount controls are shown but disabled when no backend is advertised. */
function MountBadge({ capabilities }: { capabilities: AfsCapabilities }) {
  const mount = mountAvailability(capabilities);
  return (
    <span
      className="text-[length:var(--text-xs)] text-[var(--text-secondary)]"
      title={mount.enabled ? `Mount backend: ${mount.backend}` : mount.reason}
    >
      {mount.enabled ? `Mount: ${mount.backend}` : "Mount unavailable"}
    </span>
  );
}

function ChangesPane({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<Phase<AfsDiff>>({ phase: "loading" });
  const [selected, setSelected] = useState<AfsChange | null>(null);
  const [fileDiff, setFileDiff] = useState<Phase<AfsFileDiff> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSelected(null);
    setState({ phase: "loading" });
    getJson<AfsDiff>(`/api/afs/${encodeURIComponent(sessionId)}/diff`, "Could not read the change set.")
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", data });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ phase: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!selected) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setFileDiff({ phase: "loading" });
    getJson<AfsFileDiff>(
      `/api/afs/${encodeURIComponent(sessionId)}/diff?path=${encodeURIComponent(selected.path)}`,
      "Could not read the file patch.",
    )
      .then((data) => {
        if (!cancelled) setFileDiff({ phase: "ready", data });
      })
      .catch((error: Error) => {
        if (!cancelled) setFileDiff({ phase: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId]);

  if (state.phase === "loading") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Loading changes…</p>;
  }
  if (state.phase === "error") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-danger)]">{state.message}</p>;
  }

  const diff = state.data;
  const tree = buildChangeTree(diff.changes);

  return (
    <div className="@container/afs-review min-h-0 flex-1">
      <div className="grid min-h-0 gap-2 @min-[720px]/afs-review:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <div
          className={`min-h-0 overflow-auto rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-2 ${
            selected ? "hidden @min-[720px]/afs-review:block" : "block"
          }`}
        >
          <p className="mb-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            {diff.counts.added} added · {diff.counts.modified} modified · {diff.counts.deleted} deleted ·{" "}
            {diff.counts.bytes} bytes
          </p>
          {diff.truncated ? (
            <p className="mb-1 text-[length:var(--text-xs)] text-[var(--text-warning)]">
              Diff truncated — this list is incomplete.
            </p>
          ) : null}
          {tree.length === 0 ? (
            <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
              No changes against the base.
            </p>
          ) : (
            <ul className="list-none">
              {tree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  selectedPath={selected?.path ?? null}
                  onSelect={setSelected}
                />
              ))}
            </ul>
          )}
        </div>

        <div
          className={`min-h-0 overflow-auto rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-2 ${
            selected ? "block" : "hidden @min-[720px]/afs-review:block"
          }`}
        >
          <PatchPanel selected={selected} fileDiff={fileDiff} onBack={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}

const CHANGE_BADGE: Record<AfsChange["change"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

/**
 * Depth is expressed by the nested `<ul>` itself rather than a computed
 * `paddingLeft`, so indentation stays on the spacing scale and this component
 * contributes no inline style for the design-token drift ratchet to count.
 */
function TreeRow({
  node,
  selectedPath,
  onSelect,
}: {
  node: AfsTreeNode;
  selectedPath: string | null;
  onSelect: (change: AfsChange) => void;
}) {
  const selectableChange = node.children.length === 0 ? node.change : null;
  const content = (
    <>
      {node.change ? (
        <span aria-label={node.change.change} className="w-3 shrink-0 text-[var(--text-secondary)]">
          {CHANGE_BADGE[node.change.change]}
        </span>
      ) : (
        <span aria-hidden className="w-3 shrink-0" />
      )}
      <span className="min-w-0 grow truncate text-left text-[var(--text-primary)]">{node.name}</span>
      {node.change ? (
        <span className="shrink-0 text-[var(--text-secondary)]">{node.change.bytes}B</span>
      ) : null}
      {node.change?.attribution === "unknown" ? (
        <span
          className="shrink-0 text-[var(--text-warning)]"
          title="No provenance record explains this change"
        >
          unattributed
        </span>
      ) : null}
    </>
  );

  return (
    <li>
      {selectableChange ? (
        <button
          type="button"
          aria-pressed={selectedPath === selectableChange.path}
          className={`focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-[length:var(--text-xs)] transition-colors ${
            selectedPath === selectableChange.path ? "bg-[var(--bg-elevated)]" : "hover:bg-[var(--bg-hover)]"
          }`}
          onClick={() => onSelect(selectableChange)}
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-1 py-0.5 text-[length:var(--text-xs)]">{content}</div>
      )}
      {node.children.length > 0 ? (
        <ul className="list-none pl-3">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PatchPanel({
  selected,
  fileDiff,
  onBack,
}: {
  selected: AfsChange | null;
  fileDiff: Phase<AfsFileDiff> | null;
  onBack: () => void;
}) {
  if (!selected) {
    return (
      <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
        Select a changed file to review the daemon patch.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="@min-[720px]/afs-review:hidden" onClick={onBack}>
          Back to changes
        </Button>
        <span className="min-w-0 truncate font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]">
          {selected.path}
        </span>
      </div>
      {selected.attribution === "unknown" ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-warning)]">
          This selected change has no recorded provenance.
        </p>
      ) : null}
      {!fileDiff || fileDiff.phase === "loading" ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Loading patch…</p>
      ) : null}
      {fileDiff?.phase === "error" ? (
        <p role="alert" className="text-[length:var(--text-xs)] text-[var(--text-danger)]">
          {fileDiff.message}
        </p>
      ) : null}
      {fileDiff?.phase === "ready" ? (
        <>
          {fileDiff.data.truncated ? (
            <p className="text-[length:var(--text-xs)] text-[var(--text-warning)]">
              Patch truncated — the daemon response is incomplete.
            </p>
          ) : null}
          {fileDiff.data.binary ? (
            <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Binary file.</p>
          ) : null}
          {fileDiff.data.patch.length === 0 ? (
            <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
              {fileDiff.data.binary
                ? "The daemon returned no text patch for this binary file."
                : "The daemon returned an empty text patch."}
            </p>
          ) : (
            <pre className="min-h-0 overflow-x-auto whitespace-pre rounded-[var(--radius-control)] bg-[var(--code-surface)] p-2 font-mono text-[length:var(--text-2xs)] text-[var(--text-primary)]">
              {fileDiff.data.patch}
            </pre>
          )}
        </>
      ) : null}
    </div>
  );
}

function TimelinePane({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<Phase<AfsTimeline>>({ phase: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [trace, setTrace] = useState<{ target: TraceTarget; focusSeq: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    getJson<AfsTimeline>(`/api/afs/${encodeURIComponent(sessionId)}/timeline`, "Could not read the timeline.")
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", data });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ phase: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const groups = useMemo(
    () => (state.phase === "ready" ? groupTimelineByTurn(state.data.entries) : []),
    [state],
  );

  const loadMore = useCallback(async () => {
    if (state.phase !== "ready" || !state.data.hasMore || state.data.nextCursor == null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await getJson<AfsTimeline>(
        `/api/afs/${encodeURIComponent(sessionId)}/timeline?since=${state.data.nextCursor}`,
        "Could not load more operations.",
      );
      setState((current) =>
        current.phase === "ready"
          ? { phase: "ready", data: mergeTimelinePages(current.data, page) }
          : current,
      );
    } catch (error) {
      setMoreError((error as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [sessionId, state]);

  if (state.phase === "loading") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Loading timeline…</p>;
  }
  if (state.phase === "error") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-danger)]">{state.message}</p>;
  }
  if (groups.length === 0) {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">No recorded operations.</p>;
  }

  return (
    <div className="min-h-0 overflow-auto">
      {groups.map((group) => (
        <div key={group.turn ?? "unbound"} className="mb-2">
          <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            {group.turn === null ? "No turn recorded" : `Turn ${group.turn}`}
          </p>
          <ul className="list-none">
            {group.entries.map((entry) => (
              <TimelineRow
                key={entry.seq}
                entry={entry}
                onTrace={() => {
                  if (entry.sessionId && typeof entry.turn === "number") {
                    setTrace({
                      target: { id: entry.sessionId, title: `Session ${entry.sessionId}` },
                      focusSeq: entry.turn,
                    });
                  }
                }}
              />
            ))}
          </ul>
        </div>
      ))}
      {state.data.hasMore ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={loadingMore || state.data.nextCursor == null}
          onClick={loadMore}
        >
          {loadingMore ? "Loading…" : "Load more operations"}
        </Button>
      ) : null}
      {moreError ? (
        <p role="alert" className="text-[length:var(--text-xs)] text-[var(--text-danger)]">
          {moreError}
        </p>
      ) : null}
      {trace ? (
        <SessionTraceOverlay target={trace.target} focusSeq={trace.focusSeq} onClose={() => setTrace(null)} />
      ) : null}
    </div>
  );
}

function TimelineRow({ entry, onTrace }: { entry: AfsTimelineEntry; onTrace: () => void }) {
  const canTrace = Boolean(entry.sessionId) && typeof entry.turn === "number";
  return (
    <li className="border-b border-[var(--border-hairline)] py-1 text-[length:var(--text-xs)] last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-10 shrink-0 text-[var(--text-secondary)]">{entry.op}</span>
        <span className="min-w-0 grow truncate text-[var(--text-primary)]">{entry.path}</span>
        {canTrace ? (
          <Button size="sm" variant="ghost" onClick={onTrace}>
            Open event
          </Button>
        ) : null}
      </div>
      {entry.toolCallId == null ? (
        <p className="pl-12 text-[var(--text-warning)]">unlinked</p>
      ) : entry.toolCall ? (
        <details className="mt-1 pl-12 text-[var(--text-secondary)]">
          <summary className="focus-ring cursor-pointer rounded-[var(--radius-control)]">
            Tool: {entry.toolCall.name}
          </summary>
          <div className="mt-1 grid gap-1">
            <ToolField label="Parameters" value={entry.toolCall.parameters} />
            <ToolField label="Result" value={entry.toolCall.result} />
            <ToolField label="Error" value={entry.toolCall.error} />
            <p>
              {entry.toolCall.durationMs} ms · {entry.toolCall.startedAt}–{entry.toolCall.completedAt}
            </p>
          </div>
        </details>
      ) : (
        <p className="pl-12 text-[var(--text-warning)]">Linked tool details unavailable</p>
      )}
    </li>
  );
}

function ToolField({ label, value }: { label: string; value: unknown }) {
  let rendered: string;
  if (typeof value === "string") rendered = value;
  else if (value == null) rendered = "None";
  else {
    try {
      rendered = JSON.stringify(value, null, 2);
    } catch {
      rendered = String(value);
    }
  }
  return (
    <div>
      <p>{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--code-surface)] p-1 font-mono text-[length:var(--text-2xs)] text-[var(--text-primary)]">
        {rendered}
      </pre>
    </div>
  );
}

function CommitPane({
  session,
  capabilities,
  onCommitted,
}: {
  session: AfsSession;
  capabilities: AfsCapabilities;
  onCommitted: () => void;
}) {
  const [branch, setBranch] = useState(defaultCommitBranch(session));
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [preview, setPreview] = useState<Phase<AfsCommitPreview> | null>(null);
  const [result, setResult] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const previewRequestRef = useRef(0);

  const availability = commitAvailability(capabilities, session);
  const canCommit = availability.enabled && preview?.phase === "ready" && preview.data.wouldCommit;

  const previewCommit = useCallback(async () => {
    const requestId = ++previewRequestRef.current;
    setBusy("preview");
    setPreview({ phase: "loading" });
    setResult(null);
    try {
      const res = await fetch(`/api/afs/${encodeURIComponent(session.id)}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch, dryRun: true }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(payload, "Commit preview failed."));
      if (previewRequestRef.current === requestId) {
        setPreview({ phase: "ready", data: payload as AfsCommitPreview });
      }
    } catch (error) {
      if (previewRequestRef.current === requestId) {
        setPreview({ phase: "error", message: (error as Error).message });
      }
    } finally {
      if (previewRequestRef.current === requestId) setBusy(null);
    }
  }, [branch, session.id]);

  const runCommit = useCallback(async () => {
    setBusy("commit");
    setResult(null);
    try {
      const res = await fetch(`/api/afs/${encodeURIComponent(session.id)}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(payload, "Commit failed."));
      const commit = payload as { branch?: string; commit?: string };
      setResult({
        kind: "ok",
        message: `Materialized ${commit.branch ?? branch} at ${(commit.commit ?? "").slice(0, 7)}.`,
      });
      onCommitted();
    } catch (error) {
      setResult({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }, [branch, onCommitted, session.id]);

  return (
    <div className="flex flex-col gap-2 text-[length:var(--text-xs)]">
      <label className="flex flex-col gap-1">
        <span className="text-[var(--text-secondary)]">Branch</span>
        <input
          className="focus-ring rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1 text-[var(--text-primary)]"
          value={branch}
          onChange={(event) => {
            previewRequestRef.current += 1;
            setBranch(event.target.value);
            setPreview(null);
            setBusy(null);
          }}
          disabled={busy === "commit"}
          spellCheck={false}
        />
      </label>

      {availability.enabled ? null : (
        <p className="text-[var(--text-warning)]">{availability.reason}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!availability.enabled || busy !== null}
          onClick={previewCommit}
        >
          {busy === "preview" ? "Previewing…" : "Preview commit"}
        </Button>
        <Button size="sm" disabled={!canCommit || busy !== null} onClick={runCommit}>
          <Icon name="ph:git-branch-bold" width={12} height={12} aria-hidden />
          {busy === "commit" ? "Committing…" : "Commit"}
        </Button>
      </div>

      {availability.enabled && preview === null ? (
        <p className="text-[var(--text-secondary)]">Preview this branch before committing.</p>
      ) : null}
      {preview?.phase === "loading" ? (
        <p className="text-[var(--text-secondary)]">Validating the commit with the daemon…</p>
      ) : null}
      {preview?.phase === "error" ? (
        <p role="alert" className="text-[var(--text-danger)]">
          {preview.message}
        </p>
      ) : null}
      {preview?.phase === "ready" ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-2 text-[var(--text-secondary)]">
          <p className="text-[var(--text-primary)]">{preview.data.branch}</p>
          <p>
            {preview.data.files} materialized files · {changeTotal(preview.data.counts)} changed (
            {preview.data.counts.added} added · {preview.data.counts.modified} modified ·{" "}
            {preview.data.counts.deleted} deleted) · {preview.data.counts.bytes} bytes
          </p>
          <p className="break-all">Worktree: {preview.data.worktreePath}</p>
          <p>Provenance high-water: {preview.data.provenanceHighWater}</p>
          <p>No branch was created.</p>
        </div>
      ) : null}

      {result ? (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={result.kind === "ok" ? "text-[var(--text-success)]" : "text-[var(--text-danger)]"}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
