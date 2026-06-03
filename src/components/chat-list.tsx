"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { OriginChip } from "@/components/ui/origin-chip";

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
  running:   { dot: "bg-emerald-400 animate-pulse", label: "running",   preview: "text-emerald-400" },
  completed: { dot: "bg-[var(--text-muted)]",        label: "done",      preview: "text-[var(--text-muted)]" },
  failed:    { dot: "bg-rose-400",                   label: "failed",    preview: "text-rose-400" },
  queued:    { dot: "bg-amber-400",                  label: "queued",    preview: "text-amber-400" },
  paused:    { dot: "bg-sky-400",                    label: "paused",    preview: "text-sky-400" },
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

      {/* ── Header ── */}
      <header className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
          {familiar.display_name}
        </h2>

        {/* Unreads toggle */}
        <button
          type="button"
          onClick={() => setUnreadsOnly((v) => !v)}
          className={[
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
            unreadsOnly
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-400"
              : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--text-muted)] hover:text-[var(--text-secondary)]",
          ].join(" ")}
        >
          {unreadsOnly && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
          Unreads
        </button>

        {/* Daemon badge */}
        <span
          className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
            daemonRunning
              ? "bg-emerald-950/60 text-emerald-400"
              : "bg-rose-950/60 text-rose-400"
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${daemonRunning ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
          {daemonRunning ? "daemon running" : "offline"}
        </span>

        <button
          onClick={() => onNewChat()}
          className="ml-auto flex items-center gap-1 rounded-full bg-[var(--accent-presence)] px-3 py-1 text-[12px] font-medium text-white transition-opacity hover:opacity-80 active:scale-95"
        >
          <span className="text-sm leading-none">+</span> New chat
        </button>
      </header>

      {/* ── Search ── */}
      <div className="border-b border-[var(--border-hairline)] px-3 py-2">
        <label className="flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 focus-within:border-[var(--accent-presence)]/60 transition-colors">
          <Icon name="ph:magnifying-glass" width={14} className="shrink-0 text-[var(--text-muted)]" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to search…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <Icon name="ph:x" width={12} />
            </button>
          )}
        </label>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-4 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      )}

      {/* ── List ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAny ? (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 text-[var(--text-muted)]">
              <Icon name="ph:sparkle" width={20} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">No chats yet</p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {familiar.display_name} runs on{" "}
                <code className="rounded bg-[var(--bg-raised)] px-1 font-mono text-[11px] text-[var(--text-secondary)]">
                  {familiar.harness ?? "codex"}
                </code>
                {familiar.model ? (
                  <>
                    {" "}with{" "}
                    <code className="rounded bg-[var(--bg-raised)] px-1 font-mono text-[11px] text-[var(--text-secondary)]">
                      {familiar.model}
                    </code>
                  </>
                ) : null}
                .
              </p>
            </div>
            <button
              onClick={() => onNewChat()}
              className="rounded-full bg-[var(--accent-presence)] px-5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80"
            >
              + New chat
            </button>
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
            {filtered.map((s) => {
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
                      "group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors",
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
                        {s.title || "(untitled chat)"}
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
                      className="self-center shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 transition-all hover:bg-[var(--bg-raised)] group-hover:opacity-100 disabled:opacity-40"
                    >
                      {busyTuiId === s.id ? "…" : "tui →"}
                    </button>
                  </div>
                </li>
              );
            })}
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
