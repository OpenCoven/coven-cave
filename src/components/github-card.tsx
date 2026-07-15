"use client";

/**
 * Inline GitHub cards for chat turns (design: docs/chat-github-integration.md
 * §2). W1a scope: IssueCard/PRCard hydrate from /api/github/item; commit /
 * run / review-thread descriptors render an attrs-only compact card (their
 * hydrated forms land with W1b). Cards degrade to a plain link on any fetch
 * failure — never an empty box.
 */

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
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

function useGitHubItem(repo: string, number: number | undefined, enabled: boolean): HydrationState {
  const [state, setState] = useState<HydrationState>({ phase: "loading" });
  useEffect(() => {
    if (!enabled || !number) return;
    let cancelled = false;
    setState({ phase: "loading" });
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
  }, [repo, number, enabled]);
  return state;
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

  return (
    <div
      className="cave-gh-card flex items-start gap-2.5 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-2"
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
            className="focus-ring min-w-0 truncate text-left text-[13px] font-medium text-[var(--text-primary)] hover:underline"
            aria-label={`${glyph.label}: ${title} — open on GitHub`}
            title={title}
          >
            {title}
          </button>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)]">
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
          {hydratable && state.phase === "loading" ? <span aria-live="polite">loading…</span> : null}
          {hydratable && state.phase === "unauth" ? <span>connect GitHub to hydrate</span> : null}
          {hydratable && state.phase === "error" ? <span>details unavailable</span> : null}
        </div>
        {item && item.labels.length ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.labels.slice(0, 6).map((l) => (
              <span
                key={l.name}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-1.5 py-px text-[10px] text-[var(--text-secondary)]"
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
      </div>
      <span aria-hidden className="mt-[3px] inline-flex shrink-0 text-[var(--text-secondary)]">
        <Icon name="ph:github-logo" width={13} />
      </span>
    </div>
  );
}
