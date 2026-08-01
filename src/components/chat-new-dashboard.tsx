"use client";

import "@/styles/cave-chat.css";
import "@/styles/home-dashboard.css";

// ── ChatNewDashboard ──────────────────────────────────────────────────────────
// The work-led dashboard (launcher 3a), relocated from Home to the brand-new
// chat view, then rebuilt to Chat.dc.html option 2b: one no-scroll launcher
// (greeting · a band per source of work, each a strip of tiles). The All/
// Needs-you filter tabs are gone — the bands ARE the split, by source rather
// than by state. The old context rail (project · quick start · task arming) is
// retired — ChatView's composer already owns the project picker and snippets.
// Home stays the quiet hearth; THIS surface greets a new chat, where the work
// you resume lands anyway. ChatView supplies the chrome above and the real
// composer below, so the component is body-only.
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
import { groupInboxFeed } from "@/lib/inbox-feed";
import { greetingForHour } from "@/lib/home-greeting";
import { relativeAge } from "@/lib/rss";
import { filterVisibleChatSessions } from "@/lib/chat-projects";
import { startFromGroup, startFromSub, taskTileBadge } from "@/lib/chat-start-from";
import {
  ChatStartFromBands,
  type StartFromBand,
  type StartFromTile,
} from "@/components/chat-start-from-bands";
import { queueFollowUpLabel } from "@/lib/chat-queue-followups";
import { useQueueFollowUps } from "@/lib/use-queue-followups";
import { reviewRequestLabel } from "@/lib/chat-review-requests";
import { useReviewRequests } from "@/lib/use-review-requests";
import { useDashboardBoard } from "@/components/home/use-dashboard-board";
import {
  filterFamiliarOwned,
  filterOpenWork,
  openWorkRows,
  runningTimeoutBadge,
  type OpenWorkFilter,
} from "@/components/home/dashboard-open-work";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";

/** Hard caps that keep the no-scroll board inside the pane — the overflow
 *  stays reachable through each band's trailing "All in …" tile. */
const OPEN_WORK_ROWS_CAP = 5;
const RECENT_THREADS_CAP = 3;
/** The launcher shows the top parked follow-ups; the Queue surface has the rest. */
const QUEUE_CAP = 3;
/** Reviews are the launcher's last group; a few is a prompt, a wall is a chore. */
const REVIEW_CAP = 3;

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

/** Starting a parked follow-up briefs a fresh chat with the bead — the same
 *  new-chat bridge the rest of the shell uses, so the work opens in place
 *  instead of sending the user to the Queue surface to copy an id. */
const startFollowUp = (familiarId: string | null, beadId: string, title: string) => {
  window.dispatchEvent(
    new CustomEvent("cave:agents-new-chat", {
      detail: { familiarId: familiarId ?? undefined, initialPrompt: `Pick up ${beadId}: ${title}` },
    }),
  );
};

/** Starting a review briefs a fresh chat with the PR url — same new-chat
 *  bridge the parked follow-ups use, so the work opens in place. */
const startReview = (familiarId: string | null, url: string) => {
  window.dispatchEvent(
    new CustomEvent("cave:agents-new-chat", {
      detail: { familiarId: familiarId ?? undefined, initialPrompt: `Review ${url}` },
    }),
  );
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
  const scopedBoardCards = useMemo(
    () => filterFamiliarOwned(boardCards, familiar.id),
    [boardCards, familiar.id],
  );
  const scopedNeedsYou = useMemo(
    () => filterFamiliarOwned(needsYou, familiar.id),
    [needsYou, familiar.id],
  );
  const openWork = useMemo(() => {
    const board = openWorkRows(scopedBoardCards).map((r) => ({
      ...r,
      onOpen: () => navigateMode("board"),
    }));
    const needs = scopedNeedsYou.map((item) => ({
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
  }, [scopedBoardCards, scopedNeedsYou]);
  // Parked follow-ups for the launcher's Queue group — one-shot + refresh on
  // focus, like the board and inbox snapshots; never polled.
  const queueFollowUps = useQueueFollowUps(familiar.id);
  // Reviews (cave-umgkh): PRs waiting on you. Absent without a GitHub token.
  const reviews = useReviewRequests();
  // Chat.dc.html 2b replaced the All/Needs-you filter tabs with one band per
  // SOURCE of work, so the page no longer filters a single merged list. The
  // filter helper stays in the call because the cap must still apply after it:
  // "all" is now the only tab, and the tile badge carries what the "Needs you"
  // tab used to isolate (an inbox row's badge reads `inbox`/`urgent`).
  const workFilter: OpenWorkFilter = "all";
  // Capped so the no-scroll board fits the pane; "View all in Tasks →" carries
  // the overflow.
  const visibleWork = useMemo(
    () => filterOpenWork(openWork, workFilter).slice(0, OPEN_WORK_ROWS_CAP),
    [openWork, workFilter],
  );
  // Recent threads: this familiar's freshest titled sessions, newest-first,
  // capped after applying the shared chat visibility contract.
  const recentThreads = useMemo(() => {
    return filterVisibleChatSessions(sessions, familiar.id)
      .filter((s) => Boolean(s.title?.trim()))
      .slice(0, RECENT_THREADS_CAP);
  }, [sessions, familiar.id]);

  // Group headers come from the same pure model the zero-turn starting page
  // uses, so the two new-session surfaces can't disagree about their counts.
  const tasksGroup = startFromGroup("tasks", visibleWork.length, openWork.length);
  const chatsGroup = startFromGroup(
    "chats",
    recentThreads.length,
    filterVisibleChatSessions(sessions, familiar.id).filter((s) => Boolean(s.title?.trim())).length,
  );
  // Queue (cave-3lonn): parked follow-ups from the Queue's own project. The
  // group is absent when no Queue project is chosen or nothing is parked —
  // this page never shows chrome for an empty source.
  const queueRows = queueFollowUps.rows.slice(0, QUEUE_CAP);
  const queueGroup = startFromGroup("queue", queueRows.length, queueFollowUps.rows.length);
  const reviewRows = reviews.rows.slice(0, REVIEW_CAP);
  const reviewsGroup = startFromGroup("reviews", reviewRows.length, reviews.rows.length);

  // ── Bands (Chat.dc.html 2b) ───────────────────────────────────────────────
  // One band per source, in the design's order: the threads you were just in,
  // then the board, then what you parked, then what waits on your review. A
  // source with nothing to offer contributes no band — this page never renders
  // chrome around an empty strip.
  const bands: StartFromBand[] = [];

  if (recentThreads.length > 0) {
    bands.push({
      meta: chatsGroup,
      tiles: recentThreads.map<StartFromTile>((s) => ({
        id: s.id,
        title: s.title ?? "Untitled thread",
        badge: "resume",
        sub: startFromSub([relativeAge(s.updated_at, nowMs)]),
        ariaLabel: `Resume '${s.title}'`,
        onPick: () => openSession(s.id, s.familiarId ?? null),
      })),
    });
  }

  if (visibleWork.length > 0) {
    bands.push({
      meta: tasksGroup,
      tiles: visibleWork.map<StartFromTile>((row) => {
        // One token, never two: the loud priority when there is one, else the
        // column the card sits in — the same rule the zero-turn page uses.
        const badge = taskTileBadge({ status: row.kind, priority: row.priority });
        return {
          id: row.id,
          title: row.title,
          badge,
          // The sub-line says what the badge didn't: the column when the badge
          // spent itself on a priority, then how long it has been running and
          // whether it is waiting on a human.
          sub: startFromSub([
            badge === row.kind ? null : row.kind,
            row.kind === "running"
              ? runningTimeoutBadge(row.runningSince, row.timeoutMs, nowMs)
              : null,
            row.needsHuman ? "needs you" : null,
          ]),
          ariaLabel: `Open '${row.title}' — ${row.kind}, ${row.priority} priority`,
          onPick: row.onOpen,
        };
      }),
      viewAll: {
        label: scopedNeedsYou.length > 0 ? "All in Rituals" : "All in Tasks",
        onOpen: () => navigateMode(scopedNeedsYou.length > 0 ? "inbox" : "board"),
      },
    });
  }

  if (queueRows.length > 0) {
    bands.push({
      meta: queueGroup,
      tiles: queueRows.map<StartFromTile>((row) => ({
        id: row.id,
        title: row.title,
        badge: row.updatedAt ? relativeAge(row.updatedAt, nowMs) : row.id,
        sub: startFromSub([row.id, "queued"]),
        ariaLabel: queueFollowUpLabel(row),
        hint: `Pick up ${row.id}`,
        onPick: () => startFollowUp(familiar.id, row.id, row.title),
      })),
    });
  }

  if (reviewRows.length > 0) {
    bands.push({
      meta: reviewsGroup,
      tiles: reviewRows.map<StartFromTile>((row) => ({
        id: row.id,
        title: row.title,
        badge: row.badge,
        sub: startFromSub([row.need]),
        ariaLabel: reviewRequestLabel(row),
        hint: `Review ${row.title}`,
        onPick: () => startReview(familiar.id, row.url),
      })),
    });
  }

  return (
    <div className="home-dash__body home-dash--embed select-none" data-testid="chat-new-dashboard">

      {/* Work board */}
      <main className="home-dash__board" aria-label="Work board">
        <div className="home-dash__board-inner">

          <div className="home-dash__board-head">
            <div className="home-dash__head-text">
              {/* Chat.dc.html 2b: the eyebrow names the session and its
                  familiar; the time-of-day greeting rides after it. */}
              <p className="home-dash__eyebrow">
                <span className="home-dash__eyebrow-dot" aria-hidden />
                {`New session · ${familiar.display_name}${greeting ? ` · ${greeting}` : ""}`}
              </p>
              {/* One serif line — the surface's single identity moment. It
                  states what the page is FOR rather than counting what is
                  open; the bands below do the counting. */}
              <h1 className="home-dash__headline">
                {bands.length > 0 ? "What should we begin?" : "A clean slate — what shall we conjure?"}
              </h1>
              {/* Identity meta — the roster's familiar.harness beside the
                  effective model, echoing the retired chrome's name·model. */}
              <p className="home-dash__meta">
                <span>{familiar.harness}</span>
                {modelId ? <span>{modelId}</span> : null}
              </p>
            </div>
          </div>

          {/* Chat.dc.html 2b: everything below is a launcher over work that
              already exists — one band per source, each a strip of tiles. */}
          {bands.length > 0 ? (
            <ChatStartFromBands bands={bands} />
          ) : (
            <p className="home-dash__work-empty">No open work — start something below.</p>
          )}

        </div>
      </main>
    </div>
  );
}
