"use client";

/**
 * CodeSessionPrPanel — the Code workbench's PR tab (cave-k0ua): the session's
 * pull request pipeline in one pane — stage strip (issue → PR → checks →
 * review → merged via the SAME resolveStageForBranch the work queue and chat
 * stage header use), live check runs, review threads with resolve, and
 * review/merge actions.
 *
 * Identity: the PR comes from the session's own attribution
 * (row.pullRequest — SessionPullRequestContext, cave-9q24) and the stage
 * branch from codeSessionBranch — never the shared checkout's current branch.
 * API surface reused whole: /api/queue/prs, /api/queue/issues?mode=ready,
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
import type { PullRequestSummary } from "@/lib/pr-management";
import type { MergedPrRef, ReadyIssue } from "@/lib/work-queue";
import type { SessionPullRequestContext, SessionRow } from "@/lib/types";

const STAGE_POLL_MS = 60_000;
const CHECKS_POLL_MS = 30_000;
/** Checks that passed, failed or couldn't load are read again at this pace
 *  (#5756): a push after a failure gets new checks on a new head, and until
 *  the panel saw it, review and merge stayed pinned to the old one. */
const SETTLED_CHECKS_POLL_MS = 60_000;
/** How long a review, merge or resolve may run before the rail lets go
 *  (#5756). Nothing timed these out, so a hung call kept its buttons off for
 *  good. It may still land, so the message says to check first. */
const GITHUB_ACTION_TIMEOUT_MS = 90_000;

function githubActionError(err: unknown, fallback: string): string {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `GitHub didn't answer in ${GITHUB_ACTION_TIMEOUT_MS / 1000} seconds. Check the pull request before trying again.`;
  }
  return err instanceof Error ? err.message : fallback;
}

function isTrustedPrAttribution(
  attribution: SessionPullRequestContext["attribution"] | undefined,
): attribution is "branch" {
  return attribution === "branch";
}

// ── Stage strip ───────────────────────────────────────────────────────────────

type BridgeState = {
  open: PullRequestSummary[];
  merged: MergedPrRef[];
  issues: ReadyIssue[];
  loaded: boolean;
};

const EMPTY_BRIDGE: BridgeState = { open: [], merged: [], issues: [], loaded: false };

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
        const [prsRes, issuesRes] = await Promise.all([
          fetch(`/api/queue/prs?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
          fetch(`/api/queue/issues?mode=ready&projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
        ]);
        const prs = (await prsRes.json().catch(() => null)) as
          | { ok?: boolean; open?: PullRequestSummary[]; merged?: MergedPrRef[] }
          | null;
        const issues = (await issuesRes.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (cancelled) return;
        setState({
          open: prs?.ok && Array.isArray(prs.open) ? prs.open : [],
          merged: prs?.ok && Array.isArray(prs.merged) ? prs.merged : [],
          issues: issues?.ok && Array.isArray(issues.data) ? (issues.data as ReadyIssue[]) : [],
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
      ? resolveStageForBranch({ branch, open: state.open, merged: state.merged, issues: state.issues })
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
  | { phase: "ready"; rollup: CheckSummary; runs: CheckRunDetail[]; sha: string | null }
  | { phase: "error" };

function usePrChecks(repo: string, number: number): [ChecksState, () => void] {
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
          | { ok: true; rollup: CheckSummary; runs: CheckRunDetail[]; sha?: string | null }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
          return;
        }
        setState({ phase: "ready", rollup: data.rollup, runs: data.runs, sha: data.sha ?? null });
      } catch {
        if (!cancelled) setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number, tick]);
  const pending = state.phase === "ready" && state.rollup === "pending";
  const reread = useCallback(() => setTick((t) => t + 1), []);
  usePausablePoll(reread, CHECKS_POLL_MS, { enabled: pending });
  usePausablePoll(reread, SETTLED_CHECKS_POLL_MS, { enabled: !pending && state.phase !== "loading" });
  return [state, reread];
}

function checkGlyph(run: CheckRunDetail): { glyph: string; cls: string } {
  if (run.status !== "completed") return { glyph: "●", cls: "text-[var(--accent-presence)]" };
  if (run.conclusion === "success") return { glyph: "✓", cls: "text-[var(--color-success)]" };
  if (run.conclusion === "skipped" || run.conclusion === "neutral")
    return { glyph: "○", cls: "text-[var(--text-secondary)]" };
  return { glyph: "✕", cls: "text-[var(--color-danger)]" };
}

function ChecksSection({ state, onRetry }: { state: ChecksState; onRetry: () => void }) {
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
        <p className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Couldn’t load checks.
          {/* Not a dead end (#5756): review and merge wait on these checks. */}
          <button type="button" className="focus-ring underline" onClick={onRetry}>
            Retry
          </button>
        </p>
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

function ThreadsSection({
  repo,
  number,
  allowResolve,
}: {
  repo: string;
  number: number;
  allowResolve: boolean;
}) {
  const state = usePrThreads(repo, number);
  const [busyThread, setBusyThread] = useState<string | null>(null);
  // A failed resolve says so (#5745): a network error used to escape as an
  // unhandled rejection, and a refused one changed nothing on screen.
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function toggleResolved(thread: ReviewThreadDetail) {
    setBusyThread(thread.id);
    setResolveError(null);
    try {
      const res = await fetch("/api/github/resolve-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, resolved: !thread.isResolved }),
        signal: AbortSignal.timeout(GITHUB_ACTION_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && json?.ok) state.refresh();
      else setResolveError(json?.error ?? `GitHub answered ${res.status}.`);
    } catch (err) {
      setResolveError(githubActionError(err, "The request didn't reach GitHub."));
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
      {resolveError ? (
        <p role="alert" className="mb-1 text-[length:var(--text-xs)] text-[var(--color-danger)]">
          Couldn&rsquo;t update the thread: {resolveError}
        </p>
      ) : null}
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
                {state.authed && allowResolve ? (
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
  checks,
  onActed,
  onRecheck,
}: {
  repo: string;
  number: number;
  prState: string | undefined;
  /** The checks this panel shows. Their head is what review and merge are
   *  pinned to, and merge waits for them to pass, as the full reader does
   *  (#5745). */
  checks: ChecksState;
  onActed: () => void;
  /** Read the checks again: after a refusal, the head has likely moved. */
  onRecheck: () => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "comment" | "merge">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const mergeable = (prState ?? "open").toLowerCase() === "open";
  const headSha = checks.phase === "ready" ? checks.sha : null;
  // Review and merge both act on the head the checks above ran on, so both
  // wait for it (#5751 review): an unpinned review lands on whatever commit
  // is current, not the one whose checks were shown.
  const headBlocked =
    checks.phase === "loading"
      ? "Review and merge wait for the checks to load."
      : checks.phase === "error"
        ? "Review and merge are off: the checks couldn't be loaded."
        : !checks.sha
          ? "Review and merge are off: the pull request's head is unknown."
          : null;
  const mergeBlocked =
    headBlocked
      ? headBlocked
      : checks.phase !== "ready"
        ? "Merge waits for the checks to load."
        : checks.rollup === "failing"
            ? "Merge is off: checks are failing."
            : checks.rollup === "pending"
              ? "Merge waits for the running checks."
              : checks.rollup !== "passing"
                ? "Merge is off: no checks reported for this head."
                : null;

  async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GITHUB_ACTION_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: githubActionError(err, "network error") };
    }
  }

  async function review(event: "APPROVE" | "COMMENT") {
    if (!headSha) return;
    setBusy(event === "APPROVE" ? "approve" : "comment");
    setNotice(null);
    const result = await post("/api/github/review", {
      repo,
      number,
      event,
      body: comment.trim(),
      // The head the checks above are for; GitHub reviews that commit.
      headSha,
    });
    setBusy(null);
    if (result.ok) {
      setComment("");
      setNotice({ kind: "ok", text: event === "APPROVE" ? "Approved." : "Comment posted." });
    } else {
      setNotice({ kind: "err", text: result.error ?? "Review failed." });
      // A refusal usually means the head moved (#5756): show the new one.
      onRecheck();
    }
  }

  async function merge() {
    if (mergeBlocked || !headSha) return;
    if (!confirmMerge) {
      setConfirmMerge(true);
      return;
    }
    setBusy("merge");
    setNotice(null);
    // Pinned to the head that passed (#5745): GitHub refuses the merge if
    // another commit landed since.
    const result = await post("/api/github/merge", { repo, number, method: "squash", headSha });
    setBusy(null);
    setConfirmMerge(false);
    if (result.ok) {
      setNotice({ kind: "ok", text: `PR #${number} squash-merged.` });
      onActed();
    } else {
      setNotice({ kind: "err", text: result.error ?? "Merge failed." });
      onRecheck();
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
        <Button
          size="sm"
          disabled={busy != null || !comment.trim() || headBlocked != null}
          aria-describedby={headBlocked ? "code-pr-merge-blocked" : undefined}
          onClick={() => review("COMMENT")}
        >
          {busy === "comment" ? "Posting…" : "Comment"}
        </Button>
        <Button
          size="sm"
          disabled={busy != null || headBlocked != null}
          aria-describedby={headBlocked ? "code-pr-merge-blocked" : undefined}
          onClick={() => review("APPROVE")}
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <span className="ml-auto" />
        {mergeable ? (
          <Button
            size="sm"
            disabled={busy != null || mergeBlocked != null}
            aria-describedby={mergeBlocked ? "code-pr-merge-blocked" : undefined}
            onClick={merge}
          >
            {busy === "merge" ? "Merging…" : confirmMerge ? "Confirm squash merge" : "Squash merge"}
          </Button>
        ) : null}
        {confirmMerge && busy == null ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmMerge(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {(mergeable && mergeBlocked) || headBlocked ? (
        <p id="code-pr-merge-blocked" className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {mergeBlocked}
        </p>
      ) : null}
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

/** Checks, threads and actions share one checks read (#5745): the actions
 *  pin review and merge to the head those checks are for. */
function PrReviewBlock({
  repo,
  number,
  prState,
  trustedForActions,
  onActed,
}: {
  repo: string;
  number: number;
  prState: string | undefined;
  trustedForActions: boolean;
  onActed: () => void;
}) {
  const [checks, recheck] = usePrChecks(repo, number);
  return (
    <>
      <ChecksSection state={checks} onRetry={recheck} />
      <ThreadsSection repo={repo} number={number} allowResolve={trustedForActions} />
      {trustedForActions ? (
        <ActionsSection repo={repo} number={number} prState={prState} checks={checks} onActed={onActed} onRecheck={recheck} />
      ) : null}
    </>
  );
}

export function CodeSessionPrPanel({ row }: { row: SessionRow }) {
  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const snapshot = useStageSnapshot(workRoot, branch);
  // Force-refresh key after merge so checks/threads re-fetch against the new state.
  const [actedTick, setActedTick] = useState(0);

  const pr = row.pullRequest;
  const hasPr = Boolean(pr?.repo && pr?.number != null);
  const trustedForActions = hasPr && isTrustedPrAttribution(pr?.attribution);

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
          <PrReviewBlock
            repo={pr.repo}
            number={pr.number as number}
            prState={pr.state}
            trustedForActions={trustedForActions}
            onActed={() => setActedTick((t) => t + 1)}
          />
          {trustedForActions ? null : (
            <section aria-label="Review and merge" className="flex flex-col gap-2">
              <h2 className="text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
                Actions
              </h2>
              <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-muted)] p-3 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                This PR was detected from the chat transcript, so it is shown for reference only.
                Review and merge actions stay disabled until a PR is resolved from this session&apos;s work branch.
              </div>
            </section>
          )}
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
