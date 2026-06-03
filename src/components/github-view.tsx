"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { loadGitHubTasks, type GitHubTask, type GitHubTaskStatus } from "@/lib/github-tasks";

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS: Record<GitHubTaskStatus, { dot: string; label: string; text: string }> = {
  running: { dot: "bg-emerald-400 animate-pulse", label: "running",  text: "text-emerald-400" },
  review:  { dot: "bg-amber-400",                 label: "review",   text: "text-amber-400" },
  done:    { dot: "bg-[var(--text-muted)]",        label: "done",     text: "text-[var(--text-muted)]" },
  failed:  { dot: "bg-rose-400",                  label: "failed",   text: "text-rose-400" },
};

function age(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Placeholder tasks (until coven-github API is wired) ──────────────────────

const PLACEHOLDER_TASKS: GitHubTask[] = [
  {
    id: "demo-1",
    repo: "OpenCoven/coven-code",
    issueNumber: 42,
    issueTitle: "Fix OAuth token refresh clock skew",
    branch: "cody/fix-issue-42",
    prNumber: 38,
    prUrl: "https://github.com/OpenCoven/coven-code/pull/38",
    status: "review",
    familiarId: "cody",
    familiarName: "Cody",
    sessionId: undefined,
    updatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    checkRunUrl: undefined,
  },
  {
    id: "demo-2",
    repo: "OpenCoven/coven-cave",
    issueNumber: 93,
    issueTitle: "Browser viewport flickers on tab switch",
    status: "running",
    familiarId: "cody",
    familiarName: "Cody",
    sessionId: undefined,
    updatedAt: new Date(Date.now() - 3 * 60000).toISOString(),
  },
];

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  onOpenSession?: (sessionId: string) => void;
};

export function GitHubView({ onOpenSession }: Props) {
  const [tasks, setTasks] = useState<GitHubTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "demo">("api");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GitHubTaskStatus | "all">("all");

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await loadGitHubTasks();
        if (cancelled) return;
        setTasks(next.tasks);
        setSource("api");
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setTasks(PLACEHOLDER_TASKS);
        setSource("demo");
        setError(e instanceof Error ? e.message : "GitHub task endpoint unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  const counts: Record<GitHubTaskStatus, number> = {
    running: tasks.filter((t) => t.status === "running").length,
    review:  tasks.filter((t) => t.status === "review").length,
    done:    tasks.filter((t) => t.status === "done").length,
    failed:  tasks.filter((t) => t.status === "failed").length,
  };

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon name="ph:github-logo" width={16} className="text-[var(--text-secondary)]" />
          <h2 className="text-[15px] font-semibold">GitHub Tasks</h2>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Familiar-driven issues and PRs from coven-github{source === "demo" ? " · demo fallback" : ""}
        </p>

        {counts.running > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-950/60 px-2.5 py-0.5 text-[10px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {counts.running} running
          </span>
        )}

        <a
          href="https://github.com/OpenCoven/coven-github"
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          coven-github
          <Icon name="ph:arrow-square-out" width={11} />
        </a>
      </header>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] px-4 py-2">
        {(["all", "running", "review", "done", "failed"] as const).map((f) => {
          const isActive = filter === f;
          const count = f === "all" ? tasks.length : counts[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors",
                isActive
                  ? "bg-[var(--bg-raised)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
              ].join(" ")}
            >
              {f}
              {count > 0 && (
                <span className={`rounded-full px-1 py-0.5 text-[9px] leading-none ${
                  isActive ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]" : "bg-[var(--bg-raised)] text-[var(--text-muted)]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-raised)] px-5 py-1.5 text-[11px] text-[var(--text-muted)]">
          {error}
        </div>
      ) : null}

      {/* ── List ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-[12px] text-[var(--text-muted)]">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <Icon name="ph:github-logo" width={24} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-muted)]">
              {tasks.length === 0
                ? "No GitHub tasks yet. Assign an issue to your familiar bot user to get started."
                : `No ${filter} tasks.`}
            </p>
            {tasks.length === 0 && (
              <a
                href="https://github.com/OpenCoven/coven-github/blob/main/docs/self-hosting.md"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--accent-presence)] hover:underline"
              >
                Set up coven-github →
              </a>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-hairline)]">
            {filtered.map((task) => {
              const st = STATUS[task.status];
              return (
                <li key={task.id}>
                  <div className="group flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--bg-raised)]/50 transition-colors">

                    {/* Status dot */}
                    <span className={`mt-[5px] shrink-0 h-2 w-2 rounded-full ${st.dot}`} title={st.label} />

                    {/* Content */}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* Row 1: repo + timestamp */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Icon name="ph:github-logo" width={11} className="shrink-0 text-[var(--text-muted)]" />
                          <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                            {task.repo}#{task.issueNumber}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{age(task.updatedAt)}</span>
                      </div>

                      {/* Row 2: issue title */}
                      <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                        {task.issueTitle}
                      </span>

                      {/* Row 3: status + branch/PR */}
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className={`font-medium ${st.text}`}>{st.label}</span>
                        {task.branch && (
                          <>
                            <span className="text-[var(--text-muted)]">·</span>
                            <span className="font-mono text-[var(--text-muted)]">{task.branch}</span>
                          </>
                        )}
                        {task.prNumber && (
                          <>
                            <span className="text-[var(--text-muted)]">·</span>
                            <a
href={task.prUrl ?? `https://github.com/${task.repo}/pull/${task.prNumber!}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[var(--accent-presence)] hover:underline"
                            >
                              PR #{task.prNumber}
                            </a>
                          </>
                        )}
                        <span className="ml-1 text-[11px] text-[var(--text-muted)]">
                          by {task.familiarName}
                        </span>
                      </div>
                    </div>

                    {/* Cave session button */}
                    {task.sessionId && onOpenSession ? (
                      <button
                        onClick={() => onOpenSession(task.sessionId!)}
className="self-center shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all hover:bg-[var(--bg-raised)]"
                      >
                        watch →
                      </button>
                    ) : task.checkRunUrl ? (
                      <a
                        href={task.checkRunUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
className="self-center shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all hover:bg-[var(--bg-raised)]"
                      >
                        check run →
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-hairline)] px-5 py-2 text-[10px] text-[var(--text-muted)]">
        coven-github · Coven-native GitHub App ·{" "}
        <a
          href="https://github.com/OpenCoven/coven-github"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--text-secondary)]"
        >
          github.com/OpenCoven/coven-github
        </a>
      </footer>
    </section>
  );
}
