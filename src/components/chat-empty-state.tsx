"use client";

import "@/styles/cave-chat.css";

// ── ChatEmptyState ────────────────────────────────────────────────────────────
// The familiar's starting page, shown when a chat has no turns yet. Extracted
// from chat-view.tsx when it became task-aware: besides the identity header,
// project picker and starter prompts, it surfaces the familiar's open board
// cards with one-click resume, the most recent threads, and a "Start a task"
// tile that arms a linked-card creation for the first send (card-follows-chat;
// the actual POST happens in chat-view's stream "session" handler, where the
// new session id is born).
//
// Renders inside the transcript's role="log" container — acceptable because the
// whole page is replaced by the first turn, so nothing here mutates mid-life
// in a way a log reader would narrate.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Familiar, SessionRow } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { ChatLinkedContext } from "@/lib/chat-linked-context";
import { Icon } from "@/lib/icon";
import { ProjectPicker } from "@/components/project-picker";
import { NO_PROJECT_ID, chatProjectById, filterVisibleChatSessions } from "@/lib/chat-projects";
import { cardMatchesProject, deriveOpenTaskCards, deriveContinueThreads } from "@/lib/chat-open-tasks";
import { deriveStarterSuggestions } from "@/lib/chat-starter-suggestions";
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
import { arrayContentEqual } from "@/lib/array-content-equal";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { relativeTime } from "@/lib/relative-time";
import { greetingForHour } from "@/lib/home-greeting";
import { useAnnouncer } from "@/components/ui/live-region";

const RAIL_CAP = 4;
const CONTINUE_CAP = 3;
/** The launcher shows the top parked follow-ups; the Queue surface carries the rest. */
const QUEUE_CAP = 3;
/** Reviews are the launcher's last group; a few is a prompt, a wall is a chore. */
const REVIEW_CAP = 3;
/** Only flash skeletons when the board fetch is genuinely slow; a fast load
 *  renders the rail directly and never jumps the layout twice. */
const SLOW_LOAD_MS = 300;

/** One-shot board snapshot for the rail. Abort-guarded like useProjects; no
 *  interval polling — the starting page is transient, so mount + window
 *  refocus are the only refresh points that matter. */
function useBoardCards(enabled: boolean) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/board", { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ok?: boolean; cards?: Card[] };
      if (!controller.signal.aborted) {
        const next = Array.isArray(data.cards) ? data.cards : [];
        setCards((prev) => (arrayContentEqual(prev, next) ? prev : next));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Failed to load the board");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      return;
    }
    void load();
    return () => abortRef.current?.abort();
  }, [enabled, load]);
  useRefreshOnFocus(load, { enabled });

  return { cards, loading, error, reload: load };
}

type LinkedTask = NonNullable<ChatLinkedContext["tasks"]>[number];

/** The Tasks band's overflow tile sends you to the surface that holds the rest
 *  — the same window-event bridge the rest of the shell navigates through. */
const navigateToTasks = () => {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }));
};

export function ChatEmptyState({
  familiar,
  onPrompt,
  onOpenPromptSnippets,
  projectId,
  onProjectChange,
  projects,
  createProject,
  createProjectOrThrow,
  fileMentions = false,
  sessionId = null,
  sessions = [],
  linkedContext = null,
  daemonRunning,
  modelId = null,
  taskArmed = false,
  onArmTask,
  onDisarmTask,
}: {
  familiar: Familiar;
  onPrompt?: (text: string) => void;
  /** Opens the Prompt snippets modal (templates dropped into the composer). */
  onOpenPromptSnippets?: () => void;
  /** Selected predetermined project for the chat runtime root. */
  projectId?: string | null;
  /** Updates the project used for the next send. */
  onProjectChange?: (value: string) => void;
  projects: CaveProject[];
  /** From useProjects() — enables the picker's "Add project…" row. */
  createProject?: (name: string, root: string) => Promise<CaveProject | null>;
  /** Throwing creator from useProjects(); preserves server guidance in the picker. */
  createProjectOrThrow?: (name: string, root: string) => Promise<CaveProject>;
  /** True when the chat knows a project root, so `@` opens the file picker (CHAT-D1-04). */
  fileMentions?: boolean;
  /** Non-null when this is an existing zero-turn session (e.g. a fresh task chat). */
  sessionId?: string | null;
  /** Workspace-owned session list; powers the "Continue" row without a fetch. */
  sessions?: SessionRow[];
  /** Cards already linked to this session — shown instead of the open-work rail. */
  linkedContext?: ChatLinkedContext | null;
  daemonRunning?: boolean;
  /** Effective model for the identity meta row (quiet text, not a badge). */
  modelId?: string | null;
  /** True while chat-view has a pending linked-card creation armed. */
  taskArmed?: boolean;
  onArmTask?: () => void;
  onDisarmTask?: () => void;
}) {
  const { announce } = useAnnouncer();
  const project =
    projectId === NO_PROJECT_ID
      ? null
      : (projectId ? chatProjectById(projectId, projects) ?? projects[0] : projects[0]) ?? null;

  const linkedTasks: LinkedTask[] = linkedContext?.tasks ?? [];
  const boardEnabled = linkedTasks.length === 0;
  const { cards, loading, error: boardError, reload } = useBoardCards(boardEnabled);
  // Parked follow-ups for the launcher's Queue group. One-shot + refresh on
  // focus like the board snapshot above; never polled.
  const queueFollowUps = useQueueFollowUps(familiar.id, boardEnabled);
  // Reviews (cave-umgkh): PRs waiting on you. Absent without a GitHub token.
  const reviews = useReviewRequests(boardEnabled);

  // Slow-load gate: render nothing for the first SLOW_LOAD_MS, then skeletons.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const nowMs = Date.now();
  const openCards = deriveOpenTaskCards(cards, {
    familiarId: familiar.id,
    projectId: project?.id ?? null,
    projectRoot: project?.root ?? null,
  });
  const railCards = openCards.slice(0, RAIL_CAP);
  const moreCount = Math.max(0, openCards.length - RAIL_CAP);
  const recents = deriveContinueThreads(sessions, {
    familiarId: familiar.id,
    projectRoot: project?.root ?? null,
    excludeSessionId: sessionId,
    cap: CONTINUE_CAP,
  });
  // Total resumable threads behind the capped strip — the group header says
  // "3 of 12" only when there really are more.
  const continuableCount = deriveContinueThreads(sessions, {
    familiarId: familiar.id,
    projectRoot: project?.root ?? null,
    excludeSessionId: sessionId,
    cap: Number.MAX_SAFE_INTEGER,
  }).length;
  // Resumable pills take a wider net than the rail: unassigned cards are fair
  // game (clicking a pill routes the work to THIS familiar), but another
  // familiar's cards are not — that would misroute their work.
  const resumableCards = cards
    .filter((card) => cardMatchesProject(card, {
      projectId: project?.id ?? null,
      projectRoot: project?.root ?? null,
    }))
    .filter((card) => !card.familiarId || card.familiarId === familiar.id)
    .map((card) => ({
      id: card.id,
      title: card.title,
      status: card.status,
      updatedAt: card.updatedAt,
    }));
  const suggestions = deriveStarterSuggestions({
    cards: openCards,
    sessions: filterVisibleChatSessions(sessions, familiar.id),
    taskCards: resumableCards,
    projectName: project?.name ?? null,
    nowMs,
  });

  // Time-of-day greeting for the landing eyebrow (chat-first IA). Sampled after
  // mount, client-only, to avoid SSR hydration drift — mirrors the old home hero.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  // Per-row resume/start state — one in-flight action at a time.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openSession = (sid: string, familiarId?: string | null) => {
    window.dispatchEvent(
      new CustomEvent("cave:agents-open-session", {
        detail: { sessionId: sid, familiarId: familiarId ?? undefined },
      }),
    );
  };

  const resumeCard = async (card: Card) => {
    if (busyId) return;
    setBusyId(card.id);
    setActionError(null);
    try {
      const cardProject = card.projectId ? chatProjectById(card.projectId, projects) : null;
      const projectRoot = cardProject?.root ?? undefined;
      const res = await fetch(`/api/board/${card.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: card.familiarId ?? familiar.id,
          ...(projectRoot ? { projectRoot } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "failed to open task chat");
      announce(`Opening '${card.title}'.`);
      openSession(json.sessionId, json.familiarId ?? card.familiarId ?? familiar.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "failed to open task chat");
    } finally {
      setBusyId(null);
    }
  };

  const role = familiar.role?.trim();
  const railVisible =
    boardEnabled && (railCards.length > 0 || (loading && slow) || Boolean(boardError));
  // "Start from" group headers (Chat.dc.html 2b) — counts and notes come from
  // the pure model so the header can't disagree with the tiles below it.
  const tasksGroup = startFromGroup("tasks", railCards.length, openCards.length);
  const chatsGroup = startFromGroup("chats", recents.length, continuableCount);
  // Queue (cave-3lonn): parked follow-ups from the Queue's OWN project, so
  // this page needs no extra props — and the group stays absent when no Queue
  // project is chosen or nothing is parked.
  const queueRows = queueFollowUps.rows.slice(0, QUEUE_CAP);
  const queueGroup = startFromGroup("queue", queueRows.length, queueFollowUps.rows.length);
  const reviewRows = reviews.rows.slice(0, REVIEW_CAP);
  const reviewsGroup = startFromGroup("reviews", reviewRows.length, reviews.rows.length);

  // ── Bands (Chat.dc.html 2b) ───────────────────────────────────────────────
  // Design order: the threads you were just in, the board, what you parked,
  // then what waits on your review. A source with nothing to offer contributes
  // no band, so this page never wraps chrome around an empty strip.
  const bands: StartFromBand[] = [];

  if (recents.length > 0) {
    bands.push({
      meta: chatsGroup,
      tiles: recents.map<StartFromTile>((session) => {
        const title = session.title?.trim() || "Untitled thread";
        const when = relativeTime(session.updated_at || session.created_at, nowMs);
        const diff =
          session.diff && (session.diff.additions || session.diff.deletions)
            ? `+${session.diff.additions} \u2212${session.diff.deletions}`
            : null;
        return {
          id: session.id,
          title,
          badge: "resume",
          sub: startFromSub([when, diff]),
          ariaLabel: `Continue '${title}'${when ? `, updated ${when}` : ""}`,
          onPick: () => openSession(session.id, session.familiarId),
        };
      }),
    });
  }

  if (railVisible) {
    bands.push({
      meta: tasksGroup,
      // The board's own load/error states replace the strip rather than
      // rendering half a band of tiles beside a spinner.
      status:
        loading && slow ? (
          <div
            className="cave-chat-empty-work-skeleton"
            role="status"
            aria-label="Loading open work"
          >
            <span className="cave-chat-empty-task-skeleton" />
            <span className="cave-chat-empty-task-skeleton" />
          </div>
        ) : boardError ? (
          <p className="cave-chat-empty-work-error">
            Couldn&apos;t load the board.{" "}
            <button type="button" className="cave-chat-empty-retry" onClick={() => void reload()}>
              Retry
            </button>
          </p>
        ) : actionError ? (
          <p className="cave-chat-empty-work-error" role="alert">
            {actionError}
          </p>
        ) : null,
      tiles: railCards.map<StartFromTile>((card) => {
        const needsDaemon = !card.sessionId && daemonRunning === false;
        const action = card.sessionId ? "Resume" : "Start";
        return {
          id: card.id,
          title: card.title,
          badge: taskTileBadge(card),
          sub: startFromSub([card.status, card.priority]),
          disabled: needsDaemon,
          busyLabel: busyId === card.id ? "opening…" : null,
          hint: needsDaemon ? "Starting a task needs the daemon running" : undefined,
          ariaLabel: `${action} '${card.title}' — ${card.status}, ${card.priority} priority`,
          onPick: () => void resumeCard(card),
        };
      }),
      viewAll:
        moreCount > 0
          ? { label: `+${moreCount} in Tasks`, onOpen: () => navigateToTasks() }
          : null,
    });
  }

  if (queueRows.length > 0) {
    bands.push({
      meta: queueGroup,
      tiles: queueRows.map<StartFromTile>((row) => ({
        id: row.id,
        title: row.title,
        badge: row.updatedAt ? relativeTime(row.updatedAt, nowMs) : row.id,
        sub: startFromSub([row.id, "queued"]),
        ariaLabel: queueFollowUpLabel(row),
        hint: `Pick up ${row.id}`,
        onPick: () => onPrompt?.(`Pick up ${row.id}: ${row.title}`),
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
        onPick: () => onPrompt?.(`Review ${row.url}`),
      })),
    });
  }

  return (
    <div className="cave-chat-empty select-none">
      <div className="cave-chat-empty-shell">
        <p className={`cave-chat-empty-greeting${greeting ? " is-ready" : ""}`}>
          <span className="cave-chat-empty-greeting-dot" aria-hidden />
          {/* Chat.dc.html 2b: the eyebrow names the session and its familiar;
              the time greeting rides after it instead of leading alone. */}
          <span className="cave-chat-empty-eyebrow">{`New session · ${familiar.display_name}`}</span>
          {greeting ? <span aria-hidden>·</span> : null}
          {greeting ?? " "}
        </p>

        {/* One serif line — the surface's single identity moment (DESIGN.md
            §4). It states what the page is for and flips once a project is
            chosen, mirroring the design's readiness copy. */}
        <p className="cave-chat-empty-hero">
          {project ? "Brief the familiar" : "What should we begin?"}
        </p>

        <div className="cave-chat-empty-familiar">
          <div className="cave-chat-empty-familiar-copy">
            {role ? <p className="cave-chat-empty-role">{role}</p> : null}
            <p className="cave-chat-empty-meta">
              <span>{familiar.harness}</span>
              {modelId ? <span>{modelId}</span> : null}
              {fileMentions ? <span>project files ready</span> : null}
            </p>
          </div>
        </div>

        {/* Project selection leads the page (top section) — it decides where
            the next send runs, so it isn't buried in the context disclosure. */}
        {onProjectChange && (
          <div className="cave-chat-empty-project">
            <span className="cave-chat-empty-project-head">
              <Icon name="ph:folder-open" width={14} aria-hidden />
              <span className="cave-chat-empty-project-label">Project</span>
              <ProjectPicker
                projects={projects}
                value={projectId ?? null}
                onChange={onProjectChange}
                familiarId={familiar.id}
                createProject={createProject}
                createProjectOrThrow={createProjectOrThrow}
                ariaLabel="Project for this chat"
              />
            </span>
            {project ? (
              <span className="cave-chat-empty-project-root" title={project.root}>
                {project.root}
              </span>
            ) : null}
          </div>
        )}

        {linkedTasks.length > 0 ? (
          <section className="cave-chat-empty-work" aria-label="Linked task">
            <span className="cave-chat-empty-section-label">
              <Icon name="ph:kanban" width={12} aria-hidden />
              Linked task
            </span>
            {linkedTasks.map((task) => (
              <div key={task.id} className="cave-chat-empty-task cave-chat-empty-task--static">
                <span className={`cave-chat-empty-task-status is-${task.status}`}>{task.status}</span>
                <span className="cave-chat-empty-task-title">{task.title}</span>
              </div>
            ))}
          </section>
        ) : null}

        {((onPrompt && suggestions.length > 0) || onOpenPromptSnippets) && (
          <div className="cave-chat-empty-prompts" aria-label="Starter prompts">
            {onPrompt && suggestions.map((suggestion) => {
              const isTask = suggestion.id.startsWith("task:");
              return (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => onPrompt(suggestion.text)}
                  className={`cave-chat-empty-prompt${isTask ? " cave-chat-empty-prompt--task" : ""}`}
                >
                  {isTask && <Icon name="ph:kanban" width={13} aria-hidden />}
                  <span>{suggestion.label}</span>
                  <Icon name="ph:arrow-right-bold" width={13} aria-hidden />
                </button>
              );
            })}
            {onOpenPromptSnippets && (
              <button
                type="button"
                onClick={onOpenPromptSnippets}
                className="cave-chat-empty-prompt"
              >
                <Icon name="ph:chat-centered-text" width={13} aria-hidden />
                <span>Prompt snippets</span>
              </button>
            )}
          </div>
        )}

        {/* ── "Start from" (Chat.dc.html 2b) ────────────────────────────────
            The blank page becomes a launcher over the work that already
            exists. One band per source — the same component the brand-new
            chat page uses, so the two new-session surfaces cannot disagree
            about what starting from existing work looks like. */}
        {bands.length > 0 ? <ChatStartFromBands bands={bands} /> : null}

        {/* Arming a linked card is a mode for the NEXT send, not a place to
            start from — it sits under the launcher as a quiet invitation. */}
        {project && onArmTask && linkedTasks.length === 0 ? (
          taskArmed ? (
            <div className="cave-chat-empty-task-armed" role="status">
              <Icon name="ph:kanban" width={13} aria-hidden />
              <span>Describe the task below — sending creates a linked board card.</span>
              {onDisarmTask ? (
                <button
                  type="button"
                  className="cave-chat-empty-task-armed-dismiss"
                  aria-label="Cancel task creation"
                  onClick={onDisarmTask}
                >
                  <Icon name="ph:x-bold" width={11} aria-hidden />
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="cave-chat-empty-task-tile"
              onClick={() => {
                onArmTask();
                announce("Describe the task in the message box; sending creates a linked board card.");
              }}
            >
              <Icon name="ph:kanban" width={14} aria-hidden />
              <span className="cave-chat-empty-task-tile-label">Start a task in {project.name}</span>
              <span className="cave-chat-empty-task-tile-hint">creates a linked card</span>
            </button>
          )
        ) : null}

        <p className="cave-chat-empty-hint">
          Ready for the next thread — / for commands, @ for files.
        </p>
      </div>
    </div>
  );
}
