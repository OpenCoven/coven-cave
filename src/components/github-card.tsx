"use client";

/**
 * Inline GitHub cards for chat turns (design: docs/chat-github-integration.md
 * §2). W1a scope: IssueCard/PRCard hydrate from /api/github/item; commit /
 * run / review-thread descriptors render an attrs-only compact card (their
 * hydrated forms land with W1b). Cards degrade to a plain link on any fetch
 * failure — never an empty box.
 */

import { useEffect, useState } from "react";
import { readCelebrationsEnabled } from "@/lib/celebrations-pref";
import { Icon, type IconName } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { countChecks, isFailConclusion, type CheckCounts, type CheckSummary } from "@/lib/github-checks";
import { descriptorUrl, type GitHubBlockDescriptor } from "@/lib/github-blocks";

type Person = { login: string; avatarUrl: string | null; url: string | null };

type ItemDetail = {
  ok: true;
  title: string;
  number: number;
  state: string;
  isPull: boolean;
  merged: boolean;
  draft: boolean;
  author: Person | null;
  assignees: Person[];
  labels: { name: string; color: string }[];
  updatedAt: string | null;
  htmlUrl: string | null;
  comments: number;
};

type HydrationState =
  | { phase: "loading" }
  | { phase: "ready"; item: ItemDetail }
  | { phase: "unauth" }
  | { phase: "error" };

type CheckRunDetail = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
};

type ChecksData = { rollup: CheckSummary; counts: CheckCounts; runs: CheckRunDetail[] };

type ChecksState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; data: ChecksData }
  | { phase: "error" };

/** Checks for an OPEN pull request card: one fetch + a 30s pausable re-poll
 *  while the rollup is pending (github-view idiom — hidden tabs don't spend
 *  rate limit; refreshes of the same PR are silent). */
function useCardChecks(repo: string, number: number | undefined, enabled: boolean): ChecksState {
  const [state, setState] = useState<ChecksState>({ phase: "idle" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !number) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    (async () => {
      try {
        const res = await fetch(
          `/api/github/checks?repo=${encodeURIComponent(repo)}&number=${number}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok: true; rollup: CheckSummary; runs: CheckRunDetail[] }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          // A failed refresh keeps the last good strip.
          setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
          return;
        }
        setState({
          phase: "ready",
          data: { rollup: data.rollup, counts: countChecks(data.runs), runs: data.runs },
        });
      } catch {
        if (!cancelled) setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number, enabled, tick]);
  const pending = state.phase === "ready" && state.data.rollup === "pending";
  usePausablePoll(() => setTick((t) => t + 1), 30_000, { enabled: enabled && pending });
  return state;
}

type ReviewThreadDetail = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  /** Comment id is the numeric databaseId — the same id `#discussion_r<id>`
   *  URLs carry, which is what descriptor.threadId matches against. */
  comments: { id: string; author: { login: string } | null; body: string; createdAt: string | null }[];
};

type ThreadState =
  | { phase: "loading" }
  | { phase: "ready"; threads: ReviewThreadDetail[]; authed: boolean }
  | { phase: "error" };

/** Review threads for a review-thread card — /api/github/comments, PR scope. */
function useReviewThreads(
  repo: string,
  number: number | undefined,
  enabled: boolean,
): ThreadState & { refresh: () => void } {
  const [state, setState] = useState<ThreadState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !number) return;
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
  }, [repo, number, enabled, tick]);
  return { ...state, refresh: () => setTick((t) => t + 1) };
}

function useGitHubItem(
  repo: string,
  number: number | undefined,
  enabled: boolean,
): HydrationState & { refresh: () => void } {
  const [state, setState] = useState<HydrationState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !number) return;
    let cancelled = false;
    setState((prev) => (tick > 0 && prev.phase === "ready" ? prev : { phase: "loading" }));
    (async () => {
      try {
        const res = await fetch(`/api/github/item?repo=${encodeURIComponent(repo)}&number=${number}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setState({ phase: "unauth" });
          return;
        }
        const data = (await res.json().catch(() => null)) as ItemDetail | { ok: false } | null;
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          setState({ phase: "error" });
          return;
        }
        setState({ phase: "ready", item: data });
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number, enabled, tick]);
  return { ...state, refresh: () => setTick((t) => t + 1) };
}

/** Visual identity per state — icon + accent color for the leading glyph. */
function stateGlyph(d: GitHubBlockDescriptor, item: ItemDetail | null): { icon: IconName; color: string; label: string } {
  if (d.kind === "commit") return { icon: "ph:git-branch", color: "var(--text-secondary)", label: "Commit" };
  if (d.kind === "run") return { icon: "ph:circle-notch-bold", color: "var(--text-secondary)", label: "Workflow run" };
  if (d.kind === "review-thread") return { icon: "ph:chat-circle-dots", color: "var(--text-secondary)", label: "Review thread" };
  const isPull = d.kind === "pr" || Boolean(item?.isPull);
  if (item?.merged) return { icon: "ph:git-merge", color: "var(--accent-presence)", label: "Merged" };
  const open = (item?.state ?? "open") === "open";
  if (isPull) {
    return {
      icon: "ph:git-pull-request",
      color: open ? "var(--color-success)" : "var(--text-secondary)",
      label: item?.draft ? "Draft pull request" : open ? "Open pull request" : "Closed pull request",
    };
  }
  return {
    icon: open ? "ph:circle" : "ph:check-circle",
    color: open ? "var(--color-success)" : "var(--accent-presence)",
    label: open ? "Open issue" : "Closed issue",
  };
}

type ActionPhase = "idle" | "sending" | "error";

type PendingTier2 =
  | { kind: "merge"; method: "squash" }
  | { kind: "review"; event: "APPROVE" | "REQUEST_CHANGES" };

/** Tier-1 action row + tier-2 confirm step for hydrated issue/PR cards
 *  (design §3). Tier-1 (comment, close/reopen) fires on the user's tap;
 *  tier-2 (approve, request changes, merge) opens an inline confirm strip
 *  stating exactly what will fire — proposed → confirming → firing →
 *  done|error, with GitHub's own guard errors shown verbatim. */
function CardActions({
  descriptor,
  item,
  onMutated,
  onMerged,
}: {
  descriptor: GitHubBlockDescriptor;
  item: ItemDetail;
  onMutated: () => void;
  /** Fired once on a confirmed merge — the parent card plays the reward flare. */
  onMerged?: () => void;
}) {
  const { announce } = useAnnouncer();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<ActionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTier2 | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const composerId = `gh-card-composer-${descriptor.repo.replace(/[^A-Za-z0-9]/g, "-")}-${descriptor.number}`;

  const run = async (fn: () => Promise<Response>) => {
    setPhase("sending");
    setError(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setPhase("error");
        setError(res.status === 401 ? "connect GitHub first" : (data?.error ?? `failed (${res.status})`));
        return false;
      }
      setPhase("idle");
      return true;
    } catch {
      setPhase("error");
      setError("network error");
      return false;
    }
  };

  const sendComment = async () => {
    const text = draft.trim();
    if (!text) return;
    const ok = await run(() =>
      fetch("/api/github/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: descriptor.repo, number: descriptor.number, body: text }),
      }),
    );
    if (ok) {
      setDraft("");
      setComposing(false);
      onMutated();
    }
  };

  const setIssueState = async (state: "open" | "closed") => {
    const ok = await run(() =>
      fetch("/api/github/issue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: descriptor.repo, number: descriptor.number, state }),
      }),
    );
    if (ok) onMutated();
  };

  const fireTier2 = async () => {
    if (!pending) return;
    const ok =
      pending.kind === "merge"
        ? await run(() =>
            fetch("/api/github/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ repo: descriptor.repo, number: descriptor.number, method: pending.method }),
            }),
          )
        : await run(() =>
            fetch("/api/github/review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repo: descriptor.repo,
                number: descriptor.number,
                event: pending.event,
                body: reviewBody.trim(),
              }),
            }),
          );
    if (ok) {
      // The flare is visual-only on top of this announcement (AT channel).
      if (pending.kind === "merge") {
        announce(`Merged ${descriptor.repo}#${descriptor.number}.`);
        onMerged?.();
      }
      setPending(null);
      setReviewBody("");
      onMutated();
    }
  };

  const tier2Summary = !pending
    ? ""
    : pending.kind === "merge"
      ? `Merge ${descriptor.repo}#${descriptor.number} via ${pending.method}?`
      : pending.event === "APPROVE"
        ? `Approve ${descriptor.repo}#${descriptor.number}?`
        : `Request changes on ${descriptor.repo}#${descriptor.number}?`;
  const needsBody = pending?.kind === "review" && pending.event === "REQUEST_CHANGES";

  const btn =
    "focus-ring rounded border border-[var(--border-strong)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50";

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={btn}
          onClick={() => setComposing((v) => !v)}
          disabled={phase === "sending"}
          aria-expanded={composing}
          aria-controls={composerId}
        >
          Comment
        </button>
        {!item.isPull ? (
          item.state === "open" ? (
            <button type="button" className={btn} onClick={() => setIssueState("closed")} disabled={phase === "sending"}>
              Close issue
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => setIssueState("open")} disabled={phase === "sending"}>
              Reopen issue
            </button>
          )
        ) : null}
        {item.isPull && item.state === "open" && !item.merged ? (
          <>
            <button
              type="button"
              className={btn}
              onClick={() => setPending({ kind: "review", event: "APPROVE" })}
              disabled={phase === "sending"}
            >
              Approve
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => setPending({ kind: "review", event: "REQUEST_CHANGES" })}
              disabled={phase === "sending"}
            >
              Request changes
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => setPending({ kind: "merge", method: "squash" })}
              disabled={phase === "sending"}
            >
              Merge
            </button>
          </>
        ) : null}
        {phase === "sending" ? <span className="text-[length:var(--text-2xs)] text-[var(--text-secondary)]" aria-live="polite">sending…</span> : null}
        {phase === "error" && error ? (
          <span className="text-[length:var(--text-2xs)] text-[var(--color-warning)]" role="alert">{error}</span>
        ) : null}
      </div>
      {pending ? (
        // Tier-2 confirm strip (design §3): states exactly what will fire.
        <div className="mt-1.5 rounded border border-[var(--color-danger)] px-2 py-1.5" role="group" aria-label={tier2Summary}>
          <div className="text-[length:var(--text-xs)] text-[var(--text-primary)]">{tier2Summary}</div>
          {pending.kind === "review" ? (
            <textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              rows={2}
              placeholder={needsBody ? "Why are changes needed? (required)" : "Optional review comment…"}
              aria-label="Review comment"
              className="focus-ring mt-1 min-h-[2.5em] w-full resize-y rounded border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-primary)]"
            />
          ) : null}
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              className={`${btn} border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)]`}
              onClick={fireTier2}
              disabled={phase === "sending" || (needsBody && !reviewBody.trim())}
            >
              {phase === "sending" ? "Working…" : "Confirm"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              disabled={phase === "sending"}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {composing ? (
        <div id={composerId} className="mt-1.5 flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={`Comment on ${descriptor.repo}#${descriptor.number}…`}
            aria-label={`Comment on ${descriptor.repo}#${descriptor.number}`}
            className="focus-ring min-h-[3em] w-full resize-y rounded border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-primary)]"
          />
          <button type="button" className={btn} onClick={sendComment} disabled={phase === "sending" || !draft.trim()}>
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Compact `✓ n · ✕ n · ○ n` strip with a rollup-tinted leading dot. */
function ChecksStrip({ data }: { data: ChecksData }) {
  const { rollup, counts } = data;
  if (!counts.total) return null;
  const tint =
    rollup === "failing"
      ? "var(--color-warning)"
      : rollup === "passing"
        ? "var(--color-success)"
        : "var(--text-secondary)";
  const label =
    rollup === "failing" ? "Checks failing" : rollup === "passing" ? "Checks passing" : "Checks running";
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-label={`${label}: ${counts.passed} passed, ${counts.failed} failed, ${counts.pending} pending`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: tint }} />
      <span aria-hidden>
        {counts.passed > 0 ? `✓ ${counts.passed}` : null}
        {counts.failed > 0 ? `${counts.passed > 0 ? " · " : ""}✕ ${counts.failed}` : null}
        {counts.pending > 0 ? `${counts.passed + counts.failed > 0 ? " · " : ""}○ ${counts.pending}` : null}
      </span>
    </span>
  );
}

function checkRunGlyph(run: CheckRunDetail): { icon: IconName; color: string } {
  if (run.status !== "completed") return { icon: "ph:circle-notch-bold", color: "var(--text-secondary)" };
  if (run.conclusion === "success") return { icon: "ph:check-circle", color: "var(--color-success)" };
  if (isFailConclusion(run.conclusion)) return { icon: "ph:x-circle-fill", color: "var(--color-warning)" };
  return { icon: "ph:minus-circle", color: "var(--text-secondary)" };
}

/** Expanded PR section: per-check rows linking to their logs. */
function CheckRunList({ runs, onOpenUrl }: { runs: CheckRunDetail[]; onOpenUrl?: (url: string) => void }) {
  if (!runs.length) return <div className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">No check runs.</div>;
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {runs.map((run) => {
        const glyph = checkRunGlyph(run);
        return (
          <li key={run.id} className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            <span aria-hidden className="inline-flex" style={{ color: glyph.color }}>
              <Icon name={glyph.icon} width={12} />
            </span>
            {run.detailsUrl ? (
              <button
                type="button"
                className="focus-ring min-w-0 truncate text-left hover:underline"
                onClick={() => {
                  if (onOpenUrl) onOpenUrl(run.detailsUrl!);
                  else window.open(run.detailsUrl!, "_blank", "noopener,noreferrer");
                }}
                aria-label={`Open logs for ${run.name}`}
              >
                {run.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{run.name}</span>
            )}
            <span className="ml-auto shrink-0">{run.status === "completed" ? (run.conclusion ?? "done") : run.status}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Hydrated body for a review-thread card: the thread's excerpt + state. */
function ReviewThreadBody({
  descriptor,
  onOpenUrl,
}: {
  descriptor: GitHubBlockDescriptor;
  onOpenUrl?: (url: string) => void;
}) {
  const state = useReviewThreads(descriptor.repo, descriptor.number, true);
  const [busyThread, setBusyThread] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Tier-1: resolve/unresolve fires directly through the existing GraphQL
  // route (threadId here IS the node id the mutation wants).
  const toggleResolve = async (threadId: string, resolved: boolean) => {
    setBusyThread(threadId);
    setActionError(null);
    try {
      const res = await fetch("/api/github/resolve-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, resolved }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setActionError(res.status === 401 ? "connect GitHub first" : (data?.error ?? `failed (${res.status})`));
      } else {
        state.refresh();
      }
    } catch {
      setActionError("network error");
    } finally {
      setBusyThread(null);
    }
  };

  if (state.phase === "loading")
    return <div className="text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-live="polite">loading threads…</div>;
  if (state.phase === "error")
    return <div className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">threads unavailable</div>;
  if (!state.authed)
    return <div className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">connect GitHub to see review threads</div>;
  // descriptor.threadId is the numeric discussion id from #discussion_r<id> —
  // it identifies a COMMENT (databaseId), not the thread's GraphQL node id, so
  // match the thread containing that comment.
  const thread = descriptor.threadId
    ? state.threads.find((t) => t.comments.some((c) => c.id === descriptor.threadId)) ?? null
    : null;
  const shown = thread ? [thread] : state.threads.filter((t) => !t.isResolved).slice(0, 3);
  if (!shown.length)
    return <div className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">no unresolved review threads</div>;
  return (
    <div className="space-y-2">
      {shown.map((t) => (
        <div key={t.id} className="rounded border border-[var(--border-hairline)] px-2 py-1.5">
          <div className="flex items-center gap-2 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
            {t.path ? <span className="min-w-0 truncate font-mono">{t.path}</span> : null}
            <span className="ml-auto shrink-0">{t.isResolved ? "resolved" : t.isOutdated ? "outdated" : "open"}</span>
            <button
              type="button"
              className="focus-ring shrink-0 rounded border border-[var(--border-strong)] px-1.5 py-px text-[length:var(--text-2xs)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
              onClick={() => toggleResolve(t.id, !t.isResolved)}
              disabled={busyThread != null}
              aria-label={t.isResolved ? "Unresolve this review thread" : "Resolve this review thread"}
            >
              {busyThread === t.id ? "…" : t.isResolved ? "Unresolve" : "Resolve"}
            </button>
          </div>
          {t.comments[0] ? (
            <div className="mt-1 line-clamp-3 text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {t.comments[0].author?.login ? (
                <span className="text-[var(--text-secondary)]">{t.comments[0].author.login}: </span>
              ) : null}
              {t.comments[0].body}
            </div>
          ) : null}
        </div>
      ))}
      {actionError ? <div className="text-[length:var(--text-2xs)] text-[var(--color-warning)]" role="alert">{actionError}</div> : null}
      <button
        type="button"
        className="focus-ring text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:underline"
        onClick={() => {
          const url = descriptorUrl(descriptor);
          if (onOpenUrl) onOpenUrl(url);
          else window.open(url, "_blank", "noopener,noreferrer");
        }}
      >
        open on GitHub →
      </button>
    </div>
  );
}

export function GitHubCard({
  descriptor,
  onOpenUrl,
}: {
  descriptor: GitHubBlockDescriptor;
  onOpenUrl?: (url: string) => void;
}) {
  const hydratable = descriptor.kind === "pr" || descriptor.kind === "issue";
  const state = useGitHubItem(descriptor.repo, descriptor.number, hydratable);
  const item = hydratable && state.phase === "ready" ? state.item : null;
  const url = item?.htmlUrl ?? descriptorUrl(descriptor);
  const glyph = stateGlyph(descriptor, item);

  // Checks strip + expandable run list: OPEN pull requests only — merged and
  // closed PRs have no live CI story worth a rate-limited fetch.
  const isOpenPull = Boolean(item && item.isPull && item.state === "open" && !item.merged);
  const checks = useCardChecks(descriptor.repo, descriptor.number, isOpenPull);
  const [expanded, setExpanded] = useState(false);
  const expandable = isOpenPull && checks.phase === "ready" && checks.data.counts.total > 0;

  const refText =
    descriptor.kind === "commit"
      ? descriptor.sha?.slice(0, 7)
      : descriptor.kind === "run"
        ? `run ${descriptor.runId}`
        : `#${descriptor.number}`;
  const title = item?.title ?? descriptor.title ?? url.replace("https://github.com/", "");
  const updated = item?.updatedAt ? relativeTime(item.updatedAt) : "";

  const open = () => {
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  // One-shot merge flare (cave-hshy) — the board's card-done bloom retold on
  // the PR card. Celebrations-pref gated; self-clears so re-renders can't
  // replay it; reduced-motion collapses the animation in CSS.
  const [justMerged, setJustMerged] = useState(false);
  useEffect(() => {
    if (!justMerged) return;
    const t = setTimeout(() => setJustMerged(false), 900);
    return () => clearTimeout(t);
  }, [justMerged]);

  return (
    <div
      className={`cave-gh-card flex items-start gap-2.5 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-2${justMerged ? " cave-gh-card--reward" : ""}`}
      data-gh-kind={descriptor.kind}
    >
      <span aria-hidden className="mt-[2px] inline-flex shrink-0" style={{ color: glyph.color }}>
        <Icon name={glyph.icon} width={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={open}
            className="focus-ring min-w-0 truncate text-left text-[length:var(--text-base)] font-medium text-[var(--text-primary)] hover:underline"
            aria-label={`${glyph.label}: ${title} — open on GitHub`}
            title={title}
          >
            {title}
          </button>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          <span className="font-mono">{descriptor.repo} {refText}</span>
          {item?.draft ? <span>draft</span> : null}
          {item?.author?.login ? <span>by {item.author.login}</span> : null}
          {updated ? <span>{updated}</span> : null}
          {item && item.comments > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="ph:chat-circle-dots" width={11} aria-hidden />
              {item.comments}
            </span>
          ) : null}
          {checks.phase === "ready" ? <ChecksStrip data={checks.data} /> : null}
          {hydratable && state.phase === "loading" ? <span aria-live="polite">loading…</span> : null}
          {hydratable && state.phase === "unauth" ? <span>connect GitHub to hydrate</span> : null}
          {hydratable && state.phase === "error" ? <span>details unavailable</span> : null}
        </div>
        {item && item.labels.length ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.labels.slice(0, 6).map((l) => (
              <span
                key={l.name}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-1.5 py-px text-[length:var(--text-2xs)] text-[var(--text-secondary)]"
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: l.color ? `#${l.color}` : "var(--border-strong)" }}
                />
                {l.name}
              </span>
            ))}
          </div>
        ) : null}
        {descriptor.kind === "review-thread" ? (
          <div className="mt-2">
            <ReviewThreadBody descriptor={descriptor} onOpenUrl={onOpenUrl} />
          </div>
        ) : null}
        {item ? <CardActions descriptor={descriptor} item={item} onMutated={state.refresh} onMerged={() => { if (readCelebrationsEnabled()) setJustMerged(true); }} /> : null}
        {expanded && checks.phase === "ready" ? (
          <div className="mt-2 border-t border-[var(--border-hairline)] pt-2">
            <CheckRunList runs={checks.data.runs} onOpenUrl={onOpenUrl} />
          </div>
        ) : null}
      </div>
      {expandable ? (
        <button
          type="button"
          className="focus-ring mt-[2px] inline-flex shrink-0 rounded text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse check details" : "Expand check details"}
          title={expanded ? "Hide checks" : "Show checks"}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name={expanded ? "ph:caret-up" : "ph:caret-down"} width={13} />
        </button>
      ) : null}
      <span aria-hidden className="mt-[3px] inline-flex shrink-0 text-[var(--text-secondary)]">
        <Icon name="ph:github-logo" width={13} />
      </span>
    </div>
  );
}
