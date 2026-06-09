"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { OriginChip } from "@/components/ui/origin-chip";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";

type Props = {
  familiar: Familiar;
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onOpen: (sessionId: string) => void;
  onNewChat: (projectRoot?: string) => void;
};

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "Yesterday";
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "1 week ago";
  if (d < 21) return "2 weeks ago";
  return `${Math.floor(d / 7)} weeks ago`;
}

/** Repo name — last non-empty path segment. */
function repoName(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; preview: string }> = {
  running: { dot: "bg-[var(--color-success)] animate-pulse", label: "running", preview: "text-[var(--color-success)]" },
  completed: { dot: "bg-[var(--text-muted)]", label: "done", preview: "text-[var(--text-muted)]" },
  failed: { dot: "bg-[var(--color-danger)]", label: "failed", preview: "text-[var(--color-danger)]" },
  queued: { dot: "bg-[var(--color-warning)]", label: "queued", preview: "text-[var(--color-warning)]" },
  paused: { dot: "bg-[var(--accent-presence-soft)]", label: "paused", preview: "text-[var(--accent-presence-soft)]" },
};

function statusStyle(s: string) {
  return STATUS_STYLES[s] ?? STATUS_STYLES.completed;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatList({ familiar, sessions, daemonRunning, onOpen, onNewChat }: Props) {
  const [busyTuiId, setBusyTuiId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const keys = useKeySymbols();
  const resolvedFamiliars = useResolvedFamiliars([familiar], { includeArchived: true });
  const resolvedFamiliar = resolvedFamiliars[0];

  // Focus search on Cmd+F / Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Data: filter ──────────────────────────────────────────────────────────

  const mine = useMemo(() => {
    const DEAD = new Set(["killed", "orphaned", "stopped", "archived"]);
    return sessions
      .filter((s) => s.familiarId === familiar.id && !DEAD.has(s.status))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [sessions, familiar.id]);

  const filtered = useMemo(() => {
    let rows = mine;
    if (unreadsOnly) rows = rows.filter((s) => s.status === "running");
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.project_root ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [mine, search, unreadsOnly]);

  const hasAny = mine.length > 0;
  const runningCount = mine.filter((s) => s.status === "running").length;
  const projectCount = new Set(mine.map((s) => s.project_root).filter(Boolean)).size;

  // ── Grouped by project_root ──────────────────────────────────────────────

  const grouped = useMemo(() => {
    // Build ordered groups: sessions with a project_root grouped together,
    // remaining (no project) collected into a null group at the end.
    const map = new Map<string | null, SessionRow[]>();
    for (const s of filtered) {
      const key = s.project_root ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [filtered]);

  // ── TUI launcher ─────────────────────────────────────────────────────────

  const openInTui = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setBusyTuiId(sessionId);
    setError(null);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "attach", sessionId }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "launch failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "launch failed");
    } finally {
      setBusyTuiId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">

      {/* ── Agent dossier + command strip ── */}
      <header className="agent-panel-dossier border-b border-[var(--border-hairline)] bg-[var(--bg-base)]">
        {/* Brand accent bar */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[var(--accent-presence)]/50 to-transparent" />

        {/* Identity row */}
        <div className="px-4 pb-0 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            {/* Avatar — larger + glyph-forward */}
            <div className="relative shrink-0">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--accent-presence)]/30 bg-[color-mix(in_oklch,var(--accent-presence)_12%,var(--bg-raised))] shadow-[0_0_12px_color-mix(in_oklch,var(--accent-presence)_18%,transparent)]">
                {resolvedFamiliar ? <FamiliarAvatar familiar={resolvedFamiliar} size="md" /> : null}
              </div>
              {/* Online/offline dot */}
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-base)] ${daemonRunning ? "bg-[var(--color-success)]" : "bg-[var(--text-muted)]"}`}
                title={daemonRunning ? "online" : "offline"}
              />
            </div>

            {/* Name + subtitle */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="min-w-0 truncate text-[15px] font-semibold text-[var(--text-primary)]">
                  {familiar.display_name}
                </h2>
              </div>
              <p className="mt-0.5 truncate text-[11px] leading-snug text-[var(--text-muted)]">
                {familiar.role ? (
                  <>
                    <span className="text-[var(--text-secondary)]">{familiar.role}</span>
                    {" · "}
                  </>
                ) : null}
                Agent runtime{" "}
                <span className="font-mono">{familiar.harness ?? "codex"}</span>
              </p>
            </div>

            {/* + Chat CTA */}
            <button
              type="button"
              onClick={() => onNewChat()}
              className="mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-3 text-[12px] font-semibold text-white shadow-[0_1px_8px_color-mix(in_oklch,var(--accent-presence)_35%,transparent)] transition-all hover:opacity-90 hover:shadow-[0_2px_12px_color-mix(in_oklch,var(--accent-presence)_50%,transparent)] active:scale-95"
            >
              <Icon name="ph:plus-bold" width={11} />
              Chat
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 px-4">
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:chats" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Chats</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{mine.length}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runningCount > 0 ? "animate-pulse bg-[var(--color-success)]" : "bg-[var(--text-muted)]"}`} />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Live</p>
            </div>
            <p className={`mt-1 font-mono text-[15px] font-semibold ${runningCount > 0 ? "text-[var(--color-success)]" : "text-[var(--text-primary)]"}`}>{runningCount}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:folder" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Projects</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{projectCount}</p>
          </div>
        </div>

        {/* Search + filter row */}
        <div className="mt-3 flex items-center gap-2 px-4 pb-3">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-2.5 transition-colors focus-within:border-[var(--accent-presence)]/50 focus-within:bg-[var(--bg-raised)]">
            <Icon name="ph:magnifying-glass" width={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                aria-label="Clear chat search"
              >
                <Icon name="ph:x" width={12} />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setUnreadsOnly((v) => !v)}
            className={[
              "focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              unreadsOnly
                ? "border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            {unreadsOnly
              ? <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              : <Icon name="ph:circle" width={12} />}
            Unreads
          </button>
        </div>
      </header>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-b border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-1.5 text-xs text-[var(--color-warning)]">
          {error}
        </div>
      )}

      {/* ── List ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAny ? (
          /* Empty state */
          <div className="flex h-full flex-col justify-between px-4 py-4">
            <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                  <Icon name="ph:sparkle" width={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Ready for a new thread</p>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                    Start a focused chat with {familiar.display_name}. The thread will inherit this
                    familiar's runtime and show up here once it starts.
                  </p>
                </div>
              </div>
              <div className="mt-4 divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)] text-left">
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Harness</p>
                  <p className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{familiar.harness ?? "codex"}</p>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Model</p>
                  <p className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{familiar.model ?? "default"}</p>
                </div>
              </div>
              <button
                onClick={() => onNewChat()}
                className="mt-4 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
              >
                <Icon name="ph:plus-bold" width={12} />
                Start with context
              </button>
            </div>
            <div className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">Tip:</span> use {keys.mod}F
              to jump back to chat search after this list has history.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Icon name="ph:magnifying-glass" width={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">No results for "{search}"</p>
            <button
              type="button"
              onClick={() => { setSearch(""); setUnreadsOnly(false); }}
              className="text-[12px] text-[var(--accent-presence)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-hairline)]">
            {Array.from(grouped.entries()).map(([projectRoot, rows]) => (
              <li key={projectRoot ?? "__none__"}>
                {/* Project group header */}
                {projectRoot !== null && (
                  <div className="group relative flex items-center gap-1.5 px-4 py-1.5 bg-[var(--bg-raised)]/30 border-b border-[var(--border-hairline)]">
                    <Icon name="ph:folder" width={12} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                      {repoName(projectRoot)}
                    </span>
                    <button
                      className="touch-always-visible absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewChat(projectRoot);
                      }}
                      title={`New chat in ${repoName(projectRoot)}`}
                      aria-label={`New chat in ${repoName(projectRoot)}`}
                    >
                      <Icon name="ph:plus" width="0.7rem" height="0.7rem" />
                    </button>
                  </div>
                )}
                <ul className="divide-y divide-[var(--border-hairline)]">
                  {rows.map((s) => {
                    const st = statusStyle(s.status);
                    const project = repoName(s.project_root ?? "");
                    const isActive = activeId === s.id;

                    return (
                      <li key={s.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { setActiveId(s.id); onOpen(s.id); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { setActiveId(s.id); onOpen(s.id); }
                          }}
                          className={[
                            "focus-ring-inset group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors",
                            isActive
                              ? "bg-[var(--bg-raised)]"
                              : "hover:bg-[var(--bg-raised)]/50",
                          ].join(" ")}
                        >
                          {/* Active indicator */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-8 rounded-r-full bg-[var(--accent-presence)]" />
                          )}

                          {/* Status dot (top-aligned) */}
                          <span className="mt-[5px] shrink-0">
                            <span
                              className={`block h-2 w-2 rounded-full ${st.dot}`}
                              title={st.label}
                            />
                          </span>

                          {/* Content */}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {/* Row 1: familiar/project name + timestamp */}
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">
                                  {project || familiar.display_name}
                                </span>
                                {s.origin ? <OriginChip origin={s.origin} /> : null}
                              </span>
                              <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                                {age(s.updated_at)}
                              </span>
                            </span>

                            {/* Row 2: session title (bold subject line)
                           Running sessions get full white; others are slightly muted
                           — mirrors the unread/read convention in email clients. */}
                            <span className={[
                              "truncate text-[13px] font-semibold",
                              s.status === "running"
                                ? "text-white"
                                : "text-[var(--text-primary)]",
                            ].join(" ")}>
                              {stripLeadingTrailingEmoji(s.title || "(untitled chat)")}
                            </span>

                            {/* Row 3: status preview */}
                            <span className={`truncate text-[12px] ${st.preview}`}>
                              {st.label === "running"
                                ? "Active now…"
                                : st.label === "failed"
                                  ? "Ended with an error"
                                  : st.label === "queued"
                                    ? "Waiting to start"
                                    : st.label === "paused"
                                      ? "Paused"
                                      : project
                                        ? `${familiar.display_name} · ${project}`
                                        : `${familiar.display_name}`}
                            </span>
                          </span>

                          {/* TUI button — revealed on hover */}
                          <button
                            onClick={(e) => openInTui(e, s.id)}
                            disabled={busyTuiId === s.id}
                            title="Open in Coven Code TUI"
                            className="touch-always-visible self-center shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 transition-all hover:bg-[var(--bg-raised)] group-hover:opacity-100 disabled:opacity-40"
                          >
                            {busyTuiId === s.id ? "…" : "tui →"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
        {keys.enter} open · {keys.mod}K palette · / commands in chat
      </footer>
    </section>
  );
}
