"use client";

import { useMemo, useState, useEffect } from "react";
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
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Repo name — last non-empty path segment. */
function repoName(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Two-segment short path for subtle secondary label. */
function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  running:   { dot: "bg-emerald-400 animate-pulse", label: "running",   text: "text-emerald-400" },
  completed: { dot: "bg-[var(--text-muted)]",        label: "done",      text: "text-[var(--text-muted)]" },
  failed:    { dot: "bg-rose-400",                   label: "failed",    text: "text-rose-400" },
  queued:    { dot: "bg-amber-400",                  label: "queued",    text: "text-amber-400" },
  paused:    { dot: "bg-sky-400",                    label: "paused",    text: "text-sky-400" },
};

function statusStyle(s: string) {
  return STATUS_STYLES[s] ?? STATUS_STYLES.completed;
}

// ── Persisted collapse state ─────────────────────────────────────────────────

const LS_KEY = "cave:chat-list:collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  } catch { /* storage full / SSR */ }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatList({ familiar, sessions, daemonRunning, onOpen, onNewChat }: Props) {
  const [busyTuiId, setBusyTuiId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const keys = useKeySymbols();

  // Hydrate collapse state from localStorage after mount.
  useEffect(() => { setCollapsed(loadCollapsed()); }, []);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  // ── Data: filter → group ──────────────────────────────────────────────────

  const mine = useMemo(() => {
    const DEAD = new Set(["killed", "orphaned", "stopped", "archived"]);
    return sessions
      .filter((s) => s.familiarId === familiar.id && !DEAD.has(s.status))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [sessions, familiar.id]);

  // Group by project_root. Sessions with no root go into the "general" bucket.
  const { projectGroups, general } = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    const noProject: SessionRow[] = [];

    for (const s of mine) {
      const root = s.project_root?.trim() ?? "";
      if (!root) {
        noProject.push(s);
      } else {
        const existing = map.get(root) ?? [];
        existing.push(s);
        map.set(root, existing);
      }
    }

    // Sort groups by most recent session activity.
    const groups = [...map.entries()]
      .map(([root, rows]) => ({
        root,
        name: repoName(root),
        path: shortPath(root),
        rows,
        latestAt: rows[0]?.updated_at ?? "",
        hasRunning: rows.some((r) => r.status === "running"),
      }))
      .sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));

    return { projectGroups: groups, general: noProject };
  }, [mine]);

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
      <header className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5 text-[11px]">
        <span className="font-semibold text-[var(--text-primary)]">{familiar.display_name}</span>
        <span className="text-[var(--text-muted)]">·</span>
        <span className="font-mono text-[var(--text-muted)]">{familiar.harness ?? "codex"}</span>

        <span
          className={`ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            daemonRunning
              ? "bg-emerald-950/60 text-emerald-400"
              : "bg-rose-950/60 text-rose-400"
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${daemonRunning ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
          {daemonRunning ? "daemon running" : "daemon offline"}
        </span>

        {mine.length > 0 && (
          <span className="rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            {mine.length} {mine.length === 1 ? "chat" : "chats"}
          </span>
        )}

        <button
          onClick={() => onNewChat()}
          className="ml-auto flex items-center gap-1 rounded-full bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-80 active:scale-95"
        >
          <span className="text-base leading-none">+</span> New chat
        </button>
      </header>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-4 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      )}

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAny ? (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 text-2xl">
              ✦
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">No chats yet</p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {familiar.display_name} runs on{" "}
                <code className="rounded bg-[var(--bg-raised)] px-1 font-mono text-[11px] text-[var(--text-secondary)]">
                  {familiar.harness}
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
        ) : (
          <div className="px-3 py-3 flex flex-col gap-4">

            {/* ── Project groups ── */}
            {projectGroups.map((group) => {
              const isCollapsed = collapsed.has(group.root);
              const running = group.rows.filter((s) => s.status === "running");
              const idle    = group.rows.filter((s) => s.status !== "running");

              return (
                <div key={group.root}>
                  {/* Group header */}
                  <div className="group/hdr mb-1.5 flex items-center gap-1.5 px-1">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.root)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <Icon
                        name="ph:caret-right-bold"
                        width={10}
                        className={`shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                      />
                      <Icon name="ph:folder" width={13} className="shrink-0 text-[var(--text-muted)]" />
                      <span className="truncate text-[11px] font-semibold text-[var(--text-secondary)]">
                        {group.name}
                      </span>
                      {group.hasRunning && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                      <span className="ml-1 rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                        {group.rows.length}
                      </span>
                    </button>

                    {/* New chat in project — revealed on hover */}
                    <button
                      type="button"
                      onClick={() => onNewChat(group.root)}
                      title={`New chat in ${group.name}`}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--accent-presence)] group-hover/hdr:opacity-100"
                    >
                      + new
                    </button>
                  </div>

                  {/* Rows */}
                  {!isCollapsed && (
                    <div className="flex flex-col gap-2">
                      {running.length > 0 && (
                        <ChatRows
                          rows={running}
                          onOpen={onOpen}
                          busyTuiId={busyTuiId}
                          openInTui={openInTui}
                          hideProjectPath
                        />
                      )}
                      {idle.length > 0 && (
                        <ChatRows
                          rows={idle}
                          onOpen={onOpen}
                          busyTuiId={busyTuiId}
                          openInTui={openInTui}
                          hideProjectPath
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── General (no project) ── */}
            {general.length > 0 && (
              <div>
                <div className="group/hdr mb-1.5 flex items-center gap-1.5 px-1">
                  <button
                    type="button"
                    onClick={() => toggleCollapse("__general__")}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <Icon
                      name="ph:caret-right-bold"
                      width={10}
                      className={`shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${collapsed.has("__general__") ? "" : "rotate-90"}`}
                    />
                    <Icon name="ph:chat-circle-dots" width={13} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate text-[11px] font-semibold text-[var(--text-secondary)]">
                      General
                    </span>
                    <span className="ml-1 rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                      {general.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNewChat()}
                    title="New general chat"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--accent-presence)] group-hover/hdr:opacity-100"
                  >
                    + new
                  </button>
                </div>

                {!collapsed.has("__general__") && (
                  <ChatRows
                    rows={general}
                    onOpen={onOpen}
                    busyTuiId={busyTuiId}
                    openInTui={openInTui}
                    hideProjectPath={false}
                  />
                )}
              </div>
            )}

            {/* Sparse nudge */}
            {mine.length <= 3 && (
              <button
                onClick={() => onNewChat()}
                className="w-full rounded-xl border border-dashed border-[var(--border-hairline)] py-3 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent-presence)] hover:text-[var(--accent-presence)]"
              >
                + start a new conversation
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
        {keys.enter} open · {keys.mod}K palette · / commands in chat
      </footer>
    </section>
  );
}

// ── Row sub-component ────────────────────────────────────────────────────────

type RowProps = {
  rows: SessionRow[];
  onOpen: (id: string) => void;
  busyTuiId: string | null;
  openInTui: (e: React.MouseEvent, id: string) => void;
  hideProjectPath?: boolean;
};

function ChatRows({ rows, onOpen, busyTuiId, openInTui, hideProjectPath }: RowProps) {
  return (
    <ul className="overflow-hidden rounded-xl border border-[var(--border-hairline)] divide-y divide-[var(--border-hairline)]">
      {rows.map((s) => {
        const st = statusStyle(s.status);
        return (
          <li key={s.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(s.id)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(s.id); }}
              className="group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-raised)]/50"
            >
              {/* Status dot */}
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} title={st.label} />

              {/* Title + meta */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {s.title || "(untitled chat)"}
                  </span>
                  {s.origin ? <OriginChip origin={s.origin} /> : null}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span className={`font-mono ${st.text}`}>{st.label}</span>
                  {!hideProjectPath && s.project_root && (
                    <>
                      <span>·</span>
                      <span className="truncate font-mono">{shortPath(s.project_root)}</span>
                    </>
                  )}
                </span>
              </span>

              {/* Age */}
              <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age(s.updated_at)}</span>

              {/* TUI button — revealed on hover */}
              <button
                onClick={(e) => openInTui(e, s.id)}
                disabled={busyTuiId === s.id}
                title="Open in Coven Code TUI"
                className="shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 transition-all hover:bg-[var(--bg-raised)] group-hover:opacity-100 disabled:opacity-40"
              >
                {busyTuiId === s.id ? "…" : "tui →"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
