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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  buildChangeTree,
  changeTotal,
  commitAvailability,
  commitPreview,
  defaultCommitBranch,
  groupTimelineByTurn,
  mountAvailability,
  type AfsCapabilities,
  type AfsChange,
  type AfsDiff,
  type AfsSession,
  type AfsTimeline,
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

  useEffect(() => {
    let cancelled = false;
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

  if (state.phase === "loading") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Loading changes…</p>;
  }
  if (state.phase === "error") {
    return <p className="text-[length:var(--text-xs)] text-[var(--text-danger)]">{state.message}</p>;
  }

  const diff = state.data;
  const tree = buildChangeTree(diff.changes);

  return (
    <div className="min-h-0 overflow-auto">
      <p className="mb-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
        {diff.counts.added} added · {diff.counts.modified} modified · {diff.counts.deleted} deleted ·{" "}
        {diff.counts.bytes} bytes
      </p>
      {/* Truncation is an explicit affordance, never a silently short diff. */}
      {diff.truncated ? (
        <p className="mb-1 text-[length:var(--text-xs)] text-[var(--text-warning)]">
          Diff truncated — this list is incomplete.
        </p>
      ) : null}
      {tree.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">No changes against the base.</p>
      ) : (
        <ul className="list-none">
          {tree.map((node) => (
            <TreeRow key={node.path} node={node} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

const CHANGE_BADGE: Record<AfsChange["change"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

function TreeRow({ node, depth }: { node: AfsTreeNode; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 text-[length:var(--text-xs)]"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {node.change ? (
          <span
            aria-label={node.change.change}
            className="w-3 shrink-0 text-[var(--text-secondary)]"
          >
            {CHANGE_BADGE[node.change.change]}
          </span>
        ) : (
          <span aria-hidden className="w-3 shrink-0" />
        )}
        <span className="truncate text-[var(--text-primary)]">{node.name}</span>
        {node.change ? (
          <span className="shrink-0 text-[var(--text-secondary)]">{node.change.bytes}B</span>
        ) : null}
        {/* An unexplained change is marked, never hidden (DESIGN.md §4.4). */}
        {node.change?.attribution === "unknown" ? (
          <span
            className="shrink-0 text-[var(--text-warning)]"
            title="No provenance record explains this change"
          >
            unattributed
          </span>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="list-none">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TimelinePane({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<Phase<AfsTimeline>>({ phase: "loading" });

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
              <li key={entry.seq} className="flex items-center gap-2 text-[length:var(--text-xs)]">
                <span className="w-10 shrink-0 text-[var(--text-secondary)]">{entry.op}</span>
                <span className="truncate text-[var(--text-primary)]">{entry.path}</span>
                {entry.toolCallId == null ? (
                  <span className="shrink-0 text-[var(--text-warning)]" title="No tool call is linked to this operation">
                    unlinked
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {state.data.hasMore ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          More entries available — this view is paginated.
        </p>
      ) : null}
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const availability = commitAvailability(capabilities, session);
  const preview = commitPreview(session, { counts: session.changes }, branch);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/afs/${encodeURIComponent(session.id)}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(payload, "Commit failed."));
      const commit = (payload as { commit?: string }).commit ?? "";
      setResult({ kind: "ok", message: `Materialized ${branch} at ${commit.slice(0, 7)}.` });
      onCommitted();
    } catch (error) {
      setResult({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }, [branch, onCommitted, session.id]);

  return (
    <div className="flex flex-col gap-2 text-[length:var(--text-xs)]">
      <label className="flex flex-col gap-1">
        <span className="text-[var(--text-secondary)]">Branch</span>
        <input
          className="focus-ring rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1 text-[var(--text-primary)]"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          spellCheck={false}
        />
      </label>

      <p className="text-[var(--text-secondary)]">
        {changeTotal(preview.counts)} files · {preview.counts.bytes} bytes would be applied.
      </p>
      {/* The preview is derived from the change set, not a daemon dry run
          (bead coven-y7a). Saying so is the honest affordance. */}
      <p className="text-[var(--text-secondary)]">{preview.caveat}</p>

      {availability.enabled ? null : (
        <p className="text-[var(--text-warning)]">{availability.reason}</p>
      )}

      <div>
        <Button size="sm" disabled={!availability.enabled || busy} onClick={run}>
          <Icon name="ph:git-branch-bold" width={12} height={12} aria-hidden />
          {busy ? "Committing…" : "Commit"}
        </Button>
      </div>

      {result ? (
        <p className={result.kind === "ok" ? "text-[var(--text-success)]" : "text-[var(--text-danger)]"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
