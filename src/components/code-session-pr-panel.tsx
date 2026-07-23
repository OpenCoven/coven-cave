"use client";

/**
 * CodeSessionPrPanel — the Code workbench's PR tab (cave-k0ua): the session's
 * pull request pipeline in one pane — stage strip (bead → PR → checks →
 * review → merged via the SAME resolveStageForBranch the work queue and chat
 * stage header use), live check runs, review threads with resolve, and
 * review/merge actions.
 *
 * Identity: the PR comes from the session's own attribution
 * (row.pullRequest — SessionPullRequestContext, cave-9q24) and the stage
 * branch from codeSessionBranch — never the shared checkout's current branch.
 * API surface reused whole: /api/beads/prs, /api/beads?mode=ready,
 * /api/github/{checks,comments,review,merge,resolve-thread}.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { countChecks, type CheckSummary } from "@/lib/github-checks";
import { resolveStageForBranch, type StageSnapshot, type StageStep } from "@/lib/stage-model";
import { codeSessionBranch, codeSessionWorkRoot } from "@/lib/code-surface";
import type { PullRequestSummary } from "@/lib/beads-pr-management";
import type { MergedPrRef, ReadyBead } from "@/lib/beads-work-queue";
import type { SessionRow } from "@/lib/types";

const STAGE_POLL_MS = 60_000;
const CHECKS_POLL_MS = 30_000;

// ── Stage strip ───────────────────────────────────────────────────────────────

type BridgeState = {
  open: PullRequestSummary[];
  merged: MergedPrRef[];
  beads: ReadyBead[];
  loaded: boolean;
};

const EMPTY_BRIDGE: BridgeState = { open: [], merged: [], beads: [], loaded: false };

/** PR-bridge stage for an EXPLICIT branch (the session's attributed branch —
 *  unlike chat's header, which reads the checkout's current branch). */
function useStageSnapshot(projectRoot: string, branch: string | null): StageSnapshot | null {
  const [state, setState] = useState<BridgeState>(EMPTY_BRIDGE);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!branch) {
      setState(EMPTY_BRIDGE);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [prsRes, beadsRes] = await Promise.all([
          fetch(`/api/beads/prs?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
          fetch(`/api/beads?mode=ready&projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
        ]);
        const prs = (await prsRes.json().catch(() => null)) as
          | { ok?: boolean; open?: PullRequestSummary[]; merged?: MergedPrRef[] }
          | null;
        const beads = (await beadsRes.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (cancelled) return;
        setState({
          open: prs?.ok && Array.isArray(prs.open) ? prs.open : [],
          merged: prs?.ok && Array.isArray(prs.merged) ? prs.merged : [],
          beads: beads?.ok && Array.isArray(beads.data) ? (beads.data as ReadyBead[]) : [],
          loaded: true,
        });
      } catch {
        if (!cancelled) setState({ ...EMPTY_BRIDGE, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, branch, tick]);

  const snapshot =
    state.loaded && branch
      ? resolveStageForBranch({ branch, open: state.open, merged: state.merged, beads: state.beads })
      : null;
  usePausablePoll(() => setTick((t) => t + 1), STAGE_POLL_MS, {
    enabled: Boolean(branch && snapshot?.pr),
  });
  return snapshot;
}

function stepVisual(step: StageStep): { glyph: string; cls: string } {
  switch (step.state) {
    case "done":
      return { glyph: "✓", cls: "text-[var(--color-success)]" };
    case "failed":
      return { glyph: "✕", cls: "text-[var(--color-warning)]" };
    case "active":
      return { glyph: "●", cls: "text-[var(--accent-presence)]" };
    default:
      return { glyph: "○", cls: "text-[var(--text-secondary)]" };
  }
}

function StageStrip({ snapshot }: { snapshot: StageSnapshot }) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto text-[length:var(--text-xs)] text-[var(--text-secondary)]"
      role="group"
      aria-label={`Work stage for ${snapshot.branch}`}
    >
      <span aria-hidden className="mr-1 inline-flex shrink-0">
        <Icon name="ph:git-branch" width={11} height={11} />
      </span>
      {snapshot.steps.map((step, i) => {
        const v = stepVisual(step);
        const inner = (
          <>
            <span aria-hidden className={v.cls}>{v.glyph}</span>
            <span className="whitespace-nowrap">{step.label}</span>
          </>
        );
        return (
          <span key={step.key} className="flex shrink-0 items-center gap-1">
            {i > 0 ? <span aria-hidden className="mx-0.5 text-[var(--border-strong)]">→</span> : null}
            {step.url ? (
              <a
                className="focus-ring flex items-center gap-1 rounded px-0.5 transition-colors hover:text-[var(--text-primary)]"
                title={step.detail}
                aria-label={step.detail}
                href={step.url}
                target="_blank"
                rel="noreferrer"
              >
                {inner}
              </a>
            ) : (
              <span className="flex items-center gap-1" title={step.detail} aria-label={step.detail}>
                {inner}
              </span>
            )}
          </span>
        );
      })}
      {snapshot.lane ? (
        <span className="ml-auto shrink-0 whitespace-nowrap pl-3 text-[length:var(--text-2xs)] uppercase tracking-wide">
          {snapshot.lane === "merged" ? "merged" : snapshot.lane.replace(/-/g, " ")}
        </span>
      ) : null}
    </div>
  );
}

// ── Checks ────────────────────────────────────────────────────────────────────

type CheckRunDetail = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
};

type ChecksState =
  | { phase: "loading" }
  | { phase: "ready"; rollup: CheckSummary; runs: CheckRunDetail[] }
  | { phase: "error" };

function usePrChecks(repo: string, number: number): ChecksState {
  const [state, setState] = useState<ChecksState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    (async () => {
      try {
        const res = await fetch(`/api/github/checks?repo=${encodeURIComponent(repo)}&number=${number}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as
          | { ok: true; rollup: CheckSummary; runs: CheckRunDetail[] }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
          return;
        }
        setState({ phase: "ready", rollup: data.rollup, runs: data.runs });
      } catch {
        if (!cancelled) setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number, tick]);
  const pending = state.phase === "ready" && state.rollup === "pending";
  usePausablePoll(() => setTick((t) => t + 1), CHECKS_POLL_MS, { enabled: pending });
  return state;
}

function checkGlyph(run: CheckRunDetail): { glyph: string; cls: string } {
  if (run.status !== "completed") return { glyph: "●", cls: "text-[var(--accent-presence)]" };
  if (run.conclusion === "success") return { glyph: "✓", cls: "text-[var(--color-success)]" };
  if (run.conclusion === "skipped" || run.conclusion === "neutral")
    return { glyph: "○", cls: "text-[var(--text-secondary)]" };
  return { glyph: "✕", cls: "text-[var(--color-danger)]" };
}

function ChecksSection({ repo, number }: { repo: string; number: number }) {
  const state = usePrChecks(repo, number);
  return (
    <section aria-label="Checks">
      <h3 className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Checks
        {state.phase === "ready" ? (
          <span className="ml-2 font-normal normal-case tracking-normal">
            {(() => {
              const c = countChecks(state.runs);
              return `${c.passed}/${c.total} passed${c.failed ? ` · ${c.failed} failed` : ""}${c.pending ? ` · ${c.pending} running` : ""}`;
            })()}
          </span>
        ) : null}
      </h3>
      {state.phase === "loading" ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Loading checks…</p>
      ) : state.phase === "error" ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Couldn’t load checks.</p>
      ) : state.runs.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">No check runs reported.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {state.runs.map((run) => {
            const v = checkGlyph(run);
            const inner = (
              <>
                <span aria-hidden className={`w-3 shrink-0 text-center ${v.cls}`}>{v.glyph}</span>
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
                {run.completedAt ? (
                  <span className="shrink-0 text-[var(--text-muted)]">{relativeTime(run.completedAt)}</span>
                ) : null}
              </>
            );
            return (
              <li key={run.id}>
                {run.detailsUrl ? (
                  <a
                    className="focus-ring flex items-center gap-2 rounded px-1 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    href={run.detailsUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`${run.name} — ${run.conclusion ?? run.status}`}
                  >
                    {inner}
                  </a>
                ) : (
                  <span className="flex items-center gap-2 px-1 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Review threads ────────────────────────────────────────────────────────────

type ReviewThreadDetail = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  comments: { id: string; author: { login: string } | null; body: string; createdAt: string | null }[];
};

type ThreadsState =
  | { phase: "loading" }
  | { phase: "ready"; threads: ReviewThreadDetail[]; authed: boolean }
  | { phase: "error" };

function usePrThreads(repo: string, number: number): ThreadsState & { refresh: () => void } {
  const [state, setState] = useState<ThreadsState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((prev) => (tick > 0 && prev.phase === "ready" ? prev : { phase: "loading" }));
    (async () => {
      try {
        const res = await fetch(
          `/api/github/comments?repo=${encodeURIComponent(repo)}&number=${number}&isPull=1`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok: true; authed: boolean; reviewThreads: ReviewThreadDetail[] }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          setState({ phase: "error" });
          return;
        }
        setState({ phase: "ready", threads: data.reviewThreads ?? [], authed: Boolean(data.authed) });
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

function ThreadsSection({ repo, number }: { repo: string; number: number }) {
  const state = usePrThreads(repo, number);
  const [busyThread, setBusyThread] = useState<string | null>(null);

  async function toggleResolved(thread: ReviewThreadDetail) {
    setBusyThread(thread.id);
    try {
      const res = await fetch("/api/github/resolve-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, resolved: !thread.isResolved }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) state.refresh();
    } finally {
      setBusyThread(null);
    }
  }

  if (state.phase === "loading")
    return <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Loading review threads…</p>;
  if (state.phase === "error")
    return <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Couldn’t load review threads.</p>;

  const open = state.threads.filter((t) => !t.isResolved);
  const resolved = state.threads.length - open.length;

  return (
    <section aria-label="Review threads">
      <h3 className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Review threads
        <span className="ml-2 font-normal normal-case tracking-normal">
          {open.length} open{resolved ? ` · ${resolved} resolved` : ""}
        </span>
      </h3>
      {open.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {state.threads.length === 0 ? "No review threads." : "All threads resolved."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((thread) => (
            <li
              key={thread.id}
              className="rounded border border-[var(--border-hairline)] px-2.5 py-2 text-[length:var(--text-xs)]"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[var(--text-muted)]">
                  {thread.path ?? "(general)"}
                  {thread.isOutdated ? " · outdated" : ""}
                </span>
                {state.authed ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyThread === thread.id}
                    onClick={() => toggleResolved(thread)}
                  >
                    {busyThread === thread.id ? "…" : "Resolve"}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                {thread.comments.slice(0, 4).map((c) => (
                  <div key={c.id} className="min-w-0">
                    <span className="font-medium text-[var(--text-secondary)]">
                      {c.author?.login ?? "unknown"}
                    </span>{" "}
                    <span className="whitespace-pre-wrap break-words text-[var(--text-primary)]">
                      {c.body.length > 700 ? `${c.body.slice(0, 700)}…` : c.body}
                    </span>
                  </div>
                ))}
                {thread.comments.length > 4 ? (
                  <span className="text-[var(--text-muted)]">+{thread.comments.length - 4} more replies</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Review / merge actions ────────────────────────────────────────────────────

function ActionsSection({
  repo,
  number,
  prState,
  onActed,
}: {
  repo: string;
  number: number;
  prState: string | undefined;
  onActed: () => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "comment" | "merge">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const mergeable = (prState ?? "open").toLowerCase() === "open";

  async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }

  async function review(event: "APPROVE" | "COMMENT") {
    setBusy(event === "APPROVE" ? "approve" : "comment");
    setNotice(null);
    const result = await post("/api/github/review", { repo, number, event, body: comment.trim() });
    setBusy(null);
    if (result.ok) {
      setComment("");
      setNotice({ kind: "ok", text: event === "APPROVE" ? "Approved." : "Comment posted." });
    } else {
      setNotice({ kind: "err", text: result.error ?? "Review failed." });
    }
  }

  async function merge() {
    if (!confirmMerge) {
      setConfirmMerge(true);
      return;
    }
    setBusy("merge");
    setNotice(null);
    const result = await post("/api/github/merge", { repo, number, method: "squash" });
    setBusy(null);
    setConfirmMerge(false);
    if (result.ok) {
      setNotice({ kind: "ok", text: `PR #${number} squash-merged.` });
      onActed();
    } else {
      setNotice({ kind: "err", text: result.error ?? "Merge failed." });
    }
  }

  return (
    <section aria-label="Review and merge" className="flex flex-col gap-2">
      <h3 className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Actions
      </h3>
      <textarea
        className="focus-ring-inset min-h-16 w-full resize-y rounded border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        placeholder="Review comment (optional for approve)…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={busy != null}
        aria-label="Review comment"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy != null || !comment.trim()} onClick={() => review("COMMENT")}>
          {busy === "comment" ? "Posting…" : "Comment"}
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => review("APPROVE")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <span className="ml-auto" />
        {mergeable ? (
          <Button size="sm" disabled={busy != null} onClick={merge}>
            {busy === "merge" ? "Merging…" : confirmMerge ? "Confirm squash merge" : "Squash merge"}
          </Button>
        ) : null}
        {confirmMerge && busy == null ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmMerge(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p
          role={notice.kind === "err" ? "alert" : "status"}
          className={`text-[length:var(--text-xs)] ${notice.kind === "err" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CodeSessionPrPanel({ row }: { row: SessionRow }) {
  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const snapshot = useStageSnapshot(workRoot, branch);
  // Force-refresh key after merge so checks/threads re-fetch against the new state.
  const [actedTick, setActedTick] = useState(0);

  const pr = row.pullRequest;
  const hasPr = Boolean(pr?.repo && pr?.number != null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      {snapshot ? (
        <StageStrip snapshot={snapshot} />
      ) : branch ? (
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          No pipeline stage for <span className="font-mono">{branch}</span> yet.
        </p>
      ) : null}

      {hasPr && pr ? (
        <div key={actedTick} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[length:var(--text-sm)]">
            <Icon name="ph:git-pull-request" width={14} height={14} />
            <span className="font-semibold text-[var(--text-primary)]">
              {pr.repo}#{pr.number}
            </span>
            {pr.state ? <span className="text-[var(--text-muted)]">{pr.state}</span> : null}
            {pr.draft ? <span className="text-[var(--text-muted)]">draft</span> : null}
            {pr.url ? (
              <a
                className="focus-ring ml-auto inline-flex items-center gap-1 rounded px-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]"
                href={pr.url}
                target="_blank"
                rel="noreferrer"
              >
                Open on GitHub
              </a>
            ) : null}
          </div>
          <ChecksSection repo={pr.repo} number={pr.number as number} />
          <ThreadsSection repo={pr.repo} number={pr.number as number} />
          <ActionsSection
            repo={pr.repo}
            number={pr.number as number}
            prState={pr.state}
            onActed={() => setActedTick((t) => t + 1)}
          />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          <p>No pull request is attributed to this session yet.</p>
          <p>Commit your changes in the Diff tab and use Create PR there — this tab lights up once the PR exists.</p>
        </div>
      )}
    </div>
  );
}
