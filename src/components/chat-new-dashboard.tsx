"use client";

import "@/styles/cave-chat.css";
import "@/styles/home-dashboard.css";

// ── ChatNewDashboard ──────────────────────────────────────────────────────────
// The work board that greets a brand-new chat, slimmed to a single pane: no
// context rail (the composer's footer band already owns project · model ·
// linked-work) and no filter tabs — just the greeting, a capped stack of open
// work, and a short recent-threads list. Everything fits the pane without
// scrolling; overflow defers to "+N more in Tasks".
//
// Renders inside the transcript's role="log" container as the empty state for
// `sessionId === null` chats (existing zero-turn sessions keep ChatEmptyState).
// Self-contained on purpose — it fetches its own board + inbox snapshots and
// navigates through the established window-event bridges instead of prop
// drilling through ChatSurface → ChatRouter → ChatView:
//   • cave:navigate-mode      (workspace switches surface: Tasks, Schedules)
//   • cave:agents-open-session (ChatSurface routes into an existing session)

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Familiar, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { groupInboxFeed } from "@/lib/inbox-feed";
import { greetingForHour } from "@/lib/home-greeting";
import { relativeAge } from "@/lib/rss";
import { useDashboardBoard } from "@/components/home/use-dashboard-board";
import {
  openWorkPriorityLabel,
  openWorkRows,
  runningTimeoutBadge,
} from "@/components/home/dashboard-open-work";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";

/** The board stays scroll-free: this many open-work rows at most, with the
 *  overflow deferred to "+N more in Tasks" (chat-empty-state precedent). When
 *  even the capped stack overflows a short pane, whole tail rows are shed —
 *  recent threads first, then work rows down to one — until it fits. */
const WORK_CAP = 4;
const RECENT_CAP = 3;

/** One-shot inbox snapshot for the "needs you" tier of the open-work board.
 *  Abort-guarded like useBoardCards; mount + window refocus are the only
 *  refresh points — the new-chat page is replaced by the first turn. */
function useNeedsYou() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/inbox", { cache: "no-store", signal: controller.signal });
      const json = await res.json();
      if (!controller.signal.aborted && json.ok) setItems(json.items ?? []);
    } catch {
      /* best-effort tier — the board rows render without it */
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);
  useRefreshOnFocus(load, { enabled: true });

  return useMemo(() => groupInboxFeed(items).needsYou, [items]);
}

const navigateMode = (mode: string) => {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
};

const openSession = (sessionId: string, familiarId?: string | null) => {
  window.dispatchEvent(
    new CustomEvent("cave:agents-open-session", {
      detail: { sessionId, familiarId: familiarId ?? undefined },
    }),
  );
};

/** Same best-effort read-stamp the workspace bell uses when opening an item. */
const markInboxItemRead = (id: string) => {
  if (!id || id.startsWith("missed-") || id.startsWith("eph:")) return;
  void fetch("/api/inbox/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "read", ids: [id] }),
  }).catch(() => undefined);
};

export function ChatNewDashboard({
  familiar,
  sessions = [],
  modelId = null,
}: {
  familiar: Familiar;
  /** Workspace-owned session list; powers Recent threads without a fetch. */
  sessions?: SessionRow[];
  /** Effective model for the board-head meta row (quiet text, not a badge). */
  modelId?: string | null;
}) {
  const [nowMs] = useState(() => Date.now());

  // Time-of-day greeting for the board eyebrow. Sampled after mount,
  // client-only, to avoid SSR hydration drift.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  // ── Dashboard model ────────────────────────────────────────────────────────
  // Open work = the Tasks board's live cards, followed by the "needs you"
  // attention tier (fired reminders / response-needed) as inbox rows. Each row
  // carries its own open handler: board rows jump to Tasks, needs-you rows open
  // that item's session (or land on Schedules), read-stamped like the bell.
  const boardCards = useDashboardBoard();
  const needsYou = useNeedsYou();
  const openWork = useMemo(() => {
    const board = openWorkRows(boardCards).map((r) => ({
      ...r,
      onOpen: () => navigateMode("board"),
    }));
    const needs = needsYou.map((item) => ({
      id: `needs-${item.id}`,
      title: item.title,
      kind: "inbox" as const,
      priority: "high" as const,
      needsHuman: true,
      runningSince: undefined,
      timeoutMs: undefined,
      onOpen: () => {
        markInboxItemRead(item.id);
        const sessionId =
          item.sessionId ?? (item.link?.kind === "session" ? item.link.ref : null);
        if (sessionId) openSession(sessionId, item.familiarId);
        else navigateMode("inbox");
      },
    }));
    return [...board, ...needs];
  }, [boardCards, needsYou]);
  const visibleWork = useMemo(() => openWork.slice(0, WORK_CAP), [openWork]);
  const recentPool = useMemo(
    () =>
      sessions
        .filter((s) => !s.archived_at && !s.generated && Boolean(s.title?.trim()))
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, RECENT_CAP),
    [sessions],
  );

  // ── No-scroll fit pass ─────────────────────────────────────────────────────
  // The caps fit a normal pane; on a short one the board would clip. Instead,
  // shed whole tail rows pre-paint — recent threads first, then work rows down
  // to one — re-measuring each commit until the content fits. "+N more in
  // Tasks" absorbs whatever was shed. Resets (and re-converges) when the row
  // inventory or the pane size changes.
  const boardRef = useRef<HTMLElement | null>(null);
  const [shed, dispatchShed] = useReducer(
    (n: number, action: "bump" | "reset") => (action === "bump" ? n + 1 : 0),
    0,
  );
  const recentShed = Math.min(shed, recentPool.length);
  const workShed = Math.min(
    Math.max(0, shed - recentPool.length),
    Math.max(0, visibleWork.length - 1),
  );
  const maxShed = recentPool.length + Math.max(0, visibleWork.length - 1);
  const shownWork = workShed > 0 ? visibleWork.slice(0, visibleWork.length - workShed) : visibleWork;
  const recentThreads = recentShed > 0 ? recentPool.slice(0, recentPool.length - recentShed) : recentPool;
  const moreWork = openWork.length - shownWork.length;

  useLayoutEffect(() => {
    dispatchShed("reset");
  }, [openWork.length, recentPool.length]);
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && shed < maxShed) dispatchShed("bump");
  });
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => dispatchShed("reset"));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="home-dash__body home-dash--embed select-none" data-testid="chat-new-dashboard">
      <main ref={boardRef} className="home-dash__board" aria-label="Work board">
        <div className="home-dash__board-inner">

          <div className="home-dash__board-head">
            <div className="home-dash__head-text">
              <p className="home-dash__eyebrow">
                <span className="home-dash__eyebrow-dot" aria-hidden />
                {greeting ?? "In the cave"}
              </p>
              <h1 className="home-dash__headline">
                {openWork.length > 0
                  ? `${openWork.length} thread${openWork.length === 1 ? "" : "s"} open.`
                  : "A clean slate — what shall we conjure?"}
              </h1>
              {/* Identity meta — the roster's familiar.harness beside the
                  effective model, echoing the retired chrome's name·model. */}
              <p className="home-dash__meta">
                <span>{familiar.harness}</span>
                {modelId ? <span>{modelId}</span> : null}
              </p>
            </div>
          </div>

          {/* Open work */}
          <section className="home-dash__section" aria-label="Open work">
            <div className="home-dash__section-head">
              <div className="home-dash__section-label">Open work</div>
              <button
                type="button"
                className="home-dash__section-link"
                onClick={() => navigateMode("board")}
              >
                View all in Tasks →
              </button>
            </div>
            <div className="home-dash__work">
              {shownWork.length === 0 ? (
                <div className="home-dash__work-empty">
                  No open work — start something below.
                </div>
              ) : (
                shownWork.map((row) => {
                  const priority = openWorkPriorityLabel(row.priority);
                  const badge =
                    row.kind === "running"
                      ? runningTimeoutBadge(row.runningSince, row.timeoutMs, nowMs)
                      : null;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className="home-dash__work-row"
                      onClick={row.onOpen}
                      title={`Open “${row.title}”`}
                    >
                      {row.kind === "running" ? (
                        <LifecycleBadge lifecycle="running" needsHuman={row.needsHuman} />
                      ) : (
                        <span className="home-dash__work-chip" data-kind={row.kind}>
                          {row.kind}
                        </span>
                      )}
                      <span className="home-dash__work-title">{row.title}</span>
                      {badge ? <span className="home-dash__work-meta">{badge}</span> : null}
                      {priority ? (
                        <span className="home-dash__work-priority" data-priority={priority}>
                          {priority}
                        </span>
                      ) : null}
                      {/* Visual CTA only — the whole row is the button, so
                          this stays a non-interactive span (no nested button). */}
                      <span className="home-dash__work-resume" aria-hidden>
                        Resume
                        <Icon name="ph:arrow-right-bold" width={11} />
                      </span>
                    </button>
                  );
                })
              )}
              {moreWork > 0 ? (
                <span className="home-dash__work-more">+{moreWork} more in Tasks</span>
              ) : null}
            </div>
          </section>

          {/* Recent threads */}
          {recentThreads.length > 0 ? (
            <section className="home-dash__section" aria-label="Recent threads">
              <div className="home-dash__section-label">Recent threads</div>
              <div className="home-dash__recent">
                {recentThreads.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="home-dash__recent-row"
                    onClick={() => openSession(s.id, s.familiarId ?? null)}
                    title={`Resume “${s.title}”`}
                  >
                    <span className="home-dash__recent-title">{s.title}</span>
                    <span className="home-dash__recent-time">{relativeAge(s.updated_at, nowMs)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

        </div>
      </main>
    </div>
  );
}
