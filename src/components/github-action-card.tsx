"use client";

/**
 * GitHubActionCard — agent-proposed GitHub writes (design
 * docs/chat-github-integration.md §3; bead cave-fpqx.9).
 *
 * Lifecycle: proposed → firing → done | error(+retry). Agent-initiated
 * actions ALWAYS enter at `proposed` and require a user tap regardless of
 * tier — agents propose, humans dispose. Tier-2 kinds additionally show a
 * danger-tinted Run button so the weight of merge/review/rerun/dispatch is
 * legible; there is no auto-fire path in this component at all.
 */

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { classifyGitHubAction, type GitHubActionDescriptor } from "@/lib/github-blocks";

type Phase = "proposed" | "firing" | "done" | "error" | "dismissed";

/** Human sentence for exactly what will fire — the confirm contract. */
export function describeGitHubAction(a: GitHubActionDescriptor): string {
  const target = a.number ? `${a.repo}#${a.number}` : a.repo;
  switch (a.kind) {
    case "comment":
    case "reply":
      return `Comment on ${target}`;
    case "resolve":
      return `Resolve a review thread on ${target}`;
    case "unresolve":
      return `Unresolve a review thread on ${target}`;
    case "issue-create":
      return `Create issue “${a.title ?? ""}” in ${a.repo}`;
    case "issue-state":
      // state is parse-required (actionFromAttrs) — the card says exactly
      // which direction fires (review finding, cave-jqke).
      return a.state === "open" ? `Reopen ${target}` : `Close ${target}`;
    case "review":
      return a.event === "APPROVE"
        ? `Approve ${target}`
        : a.event === "REQUEST_CHANGES"
          ? `Request changes on ${target}`
          : `Review-comment on ${target}`;
    case "merge":
      return `Merge ${target} via ${a.method ?? "squash"}`;
    case "rerun":
      return `Re-run failed jobs of run ${a.runId} in ${a.repo}`;
    case "dispatch":
      return `Dispatch ${a.workflow} @ ${a.ref} in ${a.repo}`;
  }
}

/** Fire one proposed action through the matching API route. Returns an error
 *  string, or null on success. Exported for tests. */
export async function fireGitHubAction(a: GitHubActionDescriptor): Promise<string | null> {
  const post = async (url: string, payload: Record<string, unknown>, method = "POST") => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !data?.ok) {
      return res.status === 401 ? "connect GitHub first" : (data?.error ?? `failed (${res.status})`);
    }
    return null;
  };

  switch (a.kind) {
    case "comment":
    case "reply":
      if (!a.body) return "no comment text proposed";
      return post("/api/github/comment", { repo: a.repo, number: a.number, body: a.body });
    case "resolve":
    case "unresolve": {
      // The marker must name the target comment (databaseId) — resolving "the
      // first unresolved thread" on a multi-thread PR marks the wrong thread
      // (review finding, cave-jqke).
      if (!a.threadId) return "no thread specified — the proposal must carry a thread id";
      try {
        const res = await fetch(
          `/api/github/comments?repo=${encodeURIComponent(a.repo)}&number=${a.number}&isPull=1`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok: true; reviewThreads: { id: string; isResolved: boolean; comments?: { id: string }[] }[] }
          | null;
        if (!data || data.ok !== true) return "could not load review threads";
        const want = a.kind === "resolve";
        const thread = data.reviewThreads.find((t) => t.comments?.some((c) => c.id === a.threadId));
        if (!thread) return "target thread not found on this PR";
        if (thread.isResolved === want) return want ? "thread already resolved" : "thread already unresolved";
        return post("/api/github/resolve-thread", { threadId: thread.id, resolved: want });
      } catch {
        return "network error";
      }
    }
    case "issue-create":
      return post("/api/github/issue", { repo: a.repo, title: a.title, body: a.body ?? "" });
    case "issue-state":
      return post(
        "/api/github/issue",
        { repo: a.repo, number: a.number, state: a.state === "open" ? "open" : "closed" },
        "PATCH",
      );
    case "review":
      return post("/api/github/review", { repo: a.repo, number: a.number, event: a.event, body: a.body ?? "" });
    case "merge":
      return post("/api/github/merge", { repo: a.repo, number: a.number, method: a.method ?? "squash" });
    case "rerun":
      return post("/api/github/rerun", { repo: a.repo, runId: a.runId, failedOnly: true });
    case "dispatch":
      return post("/api/github/dispatch", { repo: a.repo, workflow: a.workflow, ref: a.ref });
  }
}

export function GitHubActionCard({ action }: { action: GitHubActionDescriptor }) {
  const [phase, setPhase] = useState<Phase>("proposed");
  const [error, setError] = useState<string | null>(null);
  const tier = classifyGitHubAction(action.kind);
  const summary = describeGitHubAction(action);

  const run = async () => {
    setPhase("firing");
    setError(null);
    const err = await fireGitHubAction(action);
    if (err) {
      setError(err);
      setPhase("error");
    } else {
      setPhase("done");
    }
  };

  if (phase === "dismissed") {
    return (
      <div className="cave-gh-action text-[11px] text-[var(--text-secondary)]" data-gh-action-phase="dismissed">
        Proposal dismissed: {summary}
      </div>
    );
  }

  const btn =
    "focus-ring rounded border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-50";

  return (
    <div
      className="cave-gh-action flex items-start gap-2.5 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-2"
      data-gh-action-phase={phase}
      data-gh-action-kind={action.kind}
    >
      <span aria-hidden className="mt-[2px] inline-flex shrink-0 text-[var(--accent-presence)]">
        <Icon name="ph:github-logo" width={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[var(--text-primary)]">
          {phase === "done" ? "Done: " : "Proposed: "}
          {summary}
        </div>
        {action.note ? <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{action.note}</div> : null}
        {action.body && (action.kind === "comment" || action.kind === "reply" || action.kind === "review") ? (
          <div className="mt-1 line-clamp-3 rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            {action.body}
          </div>
        ) : null}
        {phase === "error" && error ? (
          <div className="mt-1 text-[11px] text-[var(--color-warning)]" role="alert">
            {error}
          </div>
        ) : null}
        {phase !== "done" ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              className={`${btn} ${
                tier === "confirm"
                  ? "border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)]"
                  : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
              onClick={run}
              disabled={phase === "firing"}
              aria-label={`Run proposed action: ${summary}`}
            >
              {phase === "firing" ? "Running…" : phase === "error" ? "Retry" : "Run"}
            </button>
            <button
              type="button"
              className={`${btn} border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`}
              onClick={() => setPhase("dismissed")}
              disabled={phase === "firing"}
            >
              Dismiss
            </button>
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              agent proposal
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
