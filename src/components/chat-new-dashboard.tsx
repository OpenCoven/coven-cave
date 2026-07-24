"use client";

import "@/styles/cave-chat.css";
import "@/styles/home-dashboard.css";

// ── ChatNewDashboard ──────────────────────────────────────────────────────────
// The work-led dashboard (launcher 3a), relocated from Home to the brand-new
// chat view: an open-work board (greeting + filter tabs · open work · recent
// threads). Home went back to the quiet hearth; THIS surface greets a new
// chat, where the work you resume lands anyway. ChatView supplies the chrome
// above and the real composer below (project switcher, quick starts, and task
// arming all live in that composer), so the component is board-only.
//
// Renders inside the transcript's role="log" container as the empty state for
// `sessionId === null` chats (existing zero-turn sessions keep ChatEmptyState).
// Self-contained on purpose — it fetches its own board + inbox snapshots and
// navigates through the established window-event bridges instead of prop
// drilling through ChatSurface → ChatRouter → ChatView:
//   • cave:navigate-mode      (workspace switches surface: Tasks, Schedules)
//   • cave:agents-open-session (ChatSurface routes into an existing session)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Familiar, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { groupInboxFeed } from "@/lib/inbox-feed";
import { greetingForHour } from "@/lib/home-greeting";
import { relativeAge } from "@/lib/rss";
import { useDashboardBoard } from "@/components/home/use-dashboard-board";
import {
  OPEN_WORK_FILTERS,
  OPEN_WORK_FILTER_LABEL,
  filterOpenWork,
  openWorkCounts,
  openWorkPriorityLabel,
  openWorkRows,
  runningTimeoutBadge,
  type OpenWorkFilter,
} from "@/components/home/dashboard-open-work";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";

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

  // ── Dashboard model (launcher 3a) ──────────────────────────────────────────
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
  const [workFilter, setWorkFilter] = useState<OpenWorkFilter>("all");
  const workCounts = useMemo(() => openWorkCounts(openWork), [openWork]);
  const visibleWork = useMemo(
    () => filterOpenWork(openWork, workFilter),
    [openWork, workFilter],
  );
  // Recent threads: the most-recent titled sessions, newest-first.
  const recentThreads = useMemo(() => {
    return sessions
      .filter((s) => !s.archived_at && !s.generated && Boolean(s.title?.trim()))
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 6);
  }, [sessions]);

  return (
    <div className="home-dash__body home-dash--embed select-none" data-testid="chat-new-dashboard">

      {/* Work board */}
      <main className="home-dash__board" aria-label="Work board">
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
            <div className="home-dash__filters" role="tablist" aria-label="Filter open work">
              {OPEN_WORK_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={workFilter === f}
                  className={`home-dash__filter${workFilter === f ? " is-active" : ""}`}
                  onClick={() => setWorkFilter(f)}
                >
                  {OPEN_WORK_FILTER_LABEL[f]}
                  {workCounts[f] > 0 ? (
                    <span className="home-dash__filter-count">{workCounts[f]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {/* Open work */}
          <section className="home-dash__section" aria-label="Open work">
            <div className="home-dash__section-head">
              <div className="home-dash__rail-label">Open work</div>
              {workFilter === "inbox" && needsYou.length > 0 ? (
                <button
                  type="button"
                  className="home-dash__section-link"
                  onClick={() => navigateMode("inbox")}
                >
                  View all in Rituals →
                </button>
              ) : (
                <button
                  type="button"
                  className="home-dash__section-link"
                  onClick={() => navigateMode("board")}
                >
                  View all in Tasks →
                </button>
              )}
            </div>
            <div className="home-dash__work">
              {visibleWork.length === 0 ? (
                <div className="home-dash__work-empty">
                  {openWork.length === 0
                    ? "No open work — start something below."
                    : `Nothing ${OPEN_WORK_FILTER_LABEL[workFilter].toLowerCase()} right now.`}
                </div>
              ) : (
                visibleWork.map((row) => {
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
            </div>
          </section>

          {/* Recent threads */}
          {recentThreads.length > 0 ? (
            <section className="home-dash__section" aria-label="Recent threads">
              <div className="home-dash__rail-label">Recent threads</div>
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
