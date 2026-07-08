"use client";

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
import { arrayContentEqual } from "@/lib/array-content-equal";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { relativeTime } from "@/lib/relative-time";
import { greetingForHour } from "@/lib/home-greeting";
import { useAnnouncer } from "@/components/ui/live-region";

const RAIL_CAP = 4;
const CONTINUE_CAP = 3;
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

export function ChatEmptyState({
  familiar,
  onPrompt,
  onOpenPromptSnippets,
  projectId,
  onProjectChange,
  projects,
  createProject,
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

  // "Context" disclosure: the project picker, open-work rail, task tile and
  // recent-thread rail are the *context* around a new chat, not the first thing
  // to greet you with. They collapse by default so the landing first-paints as
  // greeting + suggestions + composer (Phase 2.1); one tap reveals them.
  const [showContext, setShowContext] = useState(false);

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
  // Anything worth disclosing behind the "context" toggle?
  const hasContext =
    Boolean(onProjectChange) ||
    railVisible ||
    recents.length > 0 ||
    Boolean(project && onArmTask && linkedTasks.length === 0);

  return (
    <div className="cave-chat-empty select-none">
      <div className="cave-chat-empty-shell">
        <p className={`cave-chat-empty-greeting${greeting ? " is-ready" : ""}`}>
          <span className="cave-chat-empty-greeting-dot" aria-hidden />
          {greeting ?? " "}
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

        {hasContext ? (
          <div className="cave-chat-empty-context">
            <button
              type="button"
              className="cave-chat-empty-context-toggle"
              aria-expanded={showContext}
              onClick={() => setShowContext((v) => !v)}
            >
              <Icon name={showContext ? "ph:caret-up" : "ph:caret-down"} width={12} aria-hidden />
              <span>{showContext ? "Hide context" : "Project & open work"}</span>
            </button>

            {showContext ? (
              <div className="cave-chat-empty-context-body">
                {onProjectChange && (
                  <div className="cave-chat-empty-project">
                    <span className="cave-chat-empty-project-head">
                      <Icon name="ph:folder-open" width={14} aria-hidden />
                      <span className="cave-chat-empty-project-label">Project</span>
                      <ProjectPicker
                        projects={projects}
                        value={projectId ?? null}
                        onChange={onProjectChange}
                        allowNoProject
                        familiarId={familiar.id}
                        createProject={createProject}
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

                {railVisible ? (
                  <section className="cave-chat-empty-work" aria-label="Open work">
                    <span className="cave-chat-empty-section-label">
                      <Icon name="ph:kanban" width={12} aria-hidden />
                      Open work
                    </span>
                    {loading && slow ? (
                      <div className="cave-chat-empty-work-skeleton" role="status" aria-label="Loading open work">
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
                    ) : (
                      <>
                        {railCards.map((card) => {
                          const needsDaemon = !card.sessionId && daemonRunning === false;
                          const action = card.sessionId ? "Resume" : "Start";
                          return (
                            <button
                              key={card.id}
                              type="button"
                              className="cave-chat-empty-task"
                              disabled={busyId === card.id || needsDaemon}
                              title={needsDaemon ? "Starting a task needs the daemon running" : undefined}
                              aria-label={`${action} '${card.title}' — ${card.status}, ${card.priority} priority`}
                              onClick={() => void resumeCard(card)}
                            >
                              <span className={`cave-chat-empty-task-status is-${card.status}`}>{card.status}</span>
                              <span className="cave-chat-empty-task-title">{card.title}</span>
                              {card.priority === "urgent" || card.priority === "high" ? (
                                <span className="cave-chat-empty-task-priority">{card.priority}</span>
                              ) : null}
                              <span className="cave-chat-empty-task-action">
                                {busyId === card.id ? "Opening…" : action}
                                <Icon name="ph:arrow-right-bold" width={12} aria-hidden />
                              </span>
                            </button>
                          );
                        })}
                        {moreCount > 0 ? (
                          <span className="cave-chat-empty-work-more">+{moreCount} more on the board</span>
                        ) : null}
                      </>
                    )}
                    {actionError ? (
                      <p className="cave-chat-empty-work-error" role="alert">
                        {actionError}
                      </p>
                    ) : null}
                  </section>
                ) : null}

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

                {recents.length > 0 ? (
                  <section className="cave-chat-empty-recents" aria-label="Continue a recent thread">
                    <span className="cave-chat-empty-section-label">
                      <Icon name="ph:chat-circle-dots" width={12} aria-hidden />
                      Continue
                    </span>
                    {recents.map((session) => {
                      const title = session.title?.trim() || "Untitled thread";
                      const when = relativeTime(session.updated_at || session.created_at, nowMs);
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className="cave-chat-empty-recent"
                          aria-label={`Continue '${title}'${when ? `, updated ${when}` : ""}`}
                          onClick={() => openSession(session.id, session.familiarId)}
                        >
                          <span className="cave-chat-empty-recent-title">{title}</span>
                          {session.diff && (session.diff.additions || session.diff.deletions) ? (
                            <span className="cave-chat-empty-recent-diff">
                              +{session.diff.additions} −{session.diff.deletions}
                            </span>
                          ) : null}
                          <span className="cave-chat-empty-recent-time">{when}</span>
                        </button>
                      );
                    })}
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="cave-chat-empty-hint">
          Ready for the next thread — / for commands, @ for files.
        </p>
      </div>
    </div>
  );
}
