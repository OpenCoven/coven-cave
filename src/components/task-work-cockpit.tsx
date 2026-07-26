"use client";

import "@/styles/task-work-cockpit.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ChatView } from "@/components/chat-view";
import { TaskWorkGitHub } from "@/components/task-work-github";
import { WorkspaceRail } from "@/components/lazy-surfaces";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { WorkspaceRailSheet } from "@/components/workspace-rail-sheet";
import { Icon } from "@/lib/icon";
import { resolveTaskWorkTarget } from "@/lib/task-work-target";
import { useWorkspaceRailController } from "@/lib/use-workspace-rail-controller";
import type { Card } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  card: Card;
  familiar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning: boolean;
  onClose: () => void;
  onOpenDetails: () => void;
  onRefreshSessions: () => void | Promise<void>;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  onSessionDeleted: () => void;
  onUnlinkSession: () => Promise<boolean>;
  /** A bridge-backed task whose conversation id is reserved before its first
   * send. ChatView starts it through the normal streaming path. */
  initialPrompt?: string | null;
  onSlashCommand?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  onOpenUrl?: (url: string) => void;
};

export function TaskWorkCockpit({
  card,
  familiar,
  sessions,
  daemonRunning,
  onClose,
  onOpenDetails,
  onRefreshSessions,
  onSessionsDeleted,
  onSessionDeleted,
  onUnlinkSession,
  initialPrompt = null,
  onSlashCommand,
  onOpenOnboarding,
  onOpenUrl,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [fallbackSession, setFallbackSession] = useState<SessionRow | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "missing" | "error">("idle");
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const target = resolveTaskWorkTarget(
    card.sessionId,
    fallbackSession ? [...sessions, fallbackSession] : sessions,
  );
  const railSession = target.kind === "ready" ? target.session : null;
  const railProjectRoot = railSession?.project_root ?? card.cwd ?? null;
  const railController = useWorkspaceRailController({
    containerRef: rootRef,
    projectRoot: railProjectRoot,
    sessionId: railSession?.id ?? card.sessionId ?? null,
    sessionRunning: railSession?.status === "running",
    stopTerminalOnUnmount: true,
  });
  const openedRailSessionRef = useRef<string | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!railSession?.id || !railProjectRoot) return;
    if (openedRailSessionRef.current === railSession.id) return;
    openedRailSessionRef.current = railSession.id;
    railController.rail.reopen();
  }, [railController.rail, railProjectRoot, railSession?.id]);

  const refreshMissingSession = useCallback(async () => {
    if (!card.sessionId) return;
    setLookupState("checking");
    try {
      await onRefreshSessions();
      const params = new URLSearchParams({ includeArchived: "1" });
      if (card.familiarId) params.set("familiarId", card.familiarId);
      const response = await fetch(`/api/sessions/list?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as
        | { ok?: boolean; error?: string; sessions?: SessionRow[] }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? "session lookup failed");
      }
      const match = json.sessions?.find((session) => session.id === card.sessionId) ?? null;
      setFallbackSession(match);
      setLookupState(match ? "idle" : "missing");
    } catch {
      setLookupState("error");
    }
  }, [card.familiarId, card.sessionId, onRefreshSessions]);

  useEffect(() => {
    setFallbackSession(null);
    setLookupState("idle");
  }, [card.sessionId]);

  useEffect(() => {
    if (target.kind === "preparing" && lookupState === "idle") {
      void refreshMissingSession();
    }
  }, [lookupState, refreshMissingSession, target.kind]);

  const unlinkMissingSession = async () => {
    if (unlinking) return;
    setUnlinking(true);
    setUnlinkError(null);
    const unlinked = await onUnlinkSession();
    setUnlinking(false);
    if (unlinked) {
      onClose();
      return;
    }
    setUnlinkError("Couldn't unlink the missing session. Try again.");
  };

  return (
    <section
      ref={rootRef}
      className="task-work-cockpit"
      aria-labelledby="task-work-title"
      tabIndex={-1}
    >
      <header className="task-work-cockpit__header">
        <button type="button" className="task-work-cockpit__back focus-ring" onClick={onClose}>
          <Icon name="ph:arrow-left" width={15} aria-hidden />
          Tasks
        </button>
        <div className="task-work-cockpit__identity">
          <span className="task-work-cockpit__eyebrow">Task work</span>
          <h1 id="task-work-title">{card.title}</h1>
        </div>
        <span className="task-work-cockpit__header-actions">
          {railController.mobileAvailable ? (
            <button
              type="button"
              className="task-work-cockpit__code focus-ring"
              aria-label={railController.mobileOpen ? "Hide code rail" : "Show code rail"}
              aria-haspopup="dialog"
              aria-expanded={railController.mobileOpen}
              onClick={() => railController.setMobileOpen((open) => !open)}
            >
              <Icon name="ph:code" width={15} aria-hidden />
              Code
              {(railController.changeCount ?? 0) > 0 ? (
                <span className="workspace-rail__badge">{railController.changeCount}</span>
              ) : null}
            </button>
          ) : null}
          <button type="button" className="task-work-cockpit__details focus-ring" onClick={onOpenDetails}>
            <Icon name="ph:sidebar-simple" width={15} aria-hidden />
            Task details
          </button>
        </span>
      </header>
      <TaskWorkGitHub links={card.github} onOpenUrl={onOpenUrl} onManage={onOpenDetails} />

      <div className="task-work-cockpit__body">
        {initialPrompt && familiar ? (
          <ChatView
            familiar={familiar}
            sessionId={card.sessionId}
            session={railSession}
            projectRoot={railProjectRoot ?? undefined}
            initialPrompt={initialPrompt}
            autoSendInitialPrompt
            startNewConversation
            daemonRunning={daemonRunning}
            sessions={sessions}
            onSessionsChanged={onRefreshSessions}
            onSessionsDeleted={(sessionIds) => {
              onSessionsDeleted(sessionIds);
              if (card.sessionId && sessionIds.includes(card.sessionId)) onSessionDeleted();
            }}
            onBack={onClose}
            onSlashCommand={onSlashCommand}
            onOpenOnboarding={onOpenOnboarding}
            onOpenUrl={onOpenUrl}
          />
        ) : target.kind === "ready" && familiar ? (
          <Group
            className="task-work-cockpit__group"
            orientation="horizontal"
            // The library retains an in-memory layout per panel-id set, so
            // when the code rail collapses (its Panel unmounts) the surviving
            // conversation panel kept its stale two-panel width — the chat sat
            // at ~half the cockpit beside dead space. Remount the Group per
            // pane set (the chat-split-host convention) so each set lays out
            // fresh and a solo conversation always fills the cockpit.
            key={railController.showInline ? "conversation-rail" : "conversation"}
          >
            <Panel id="task-conversation" className="flex min-h-0 min-w-0" minSize="45%">
              <ChatView
                familiar={familiar}
                sessionId={target.session.id}
                session={target.session}
                daemonRunning={daemonRunning}
                sessions={sessions}
                onSessionsChanged={onRefreshSessions}
                onSessionsDeleted={(sessionIds) => {
                  onSessionsDeleted(sessionIds);
                  if (sessionIds.includes(target.session.id)) onSessionDeleted();
                }}
                onBack={onClose}
                onSlashCommand={onSlashCommand}
                onOpenOnboarding={onOpenOnboarding}
                onOpenUrl={onOpenUrl}
              />
            </Panel>
            {railController.showInline ? (
              <>
                <Separator className="shell-separator hidden lg:flex">
                  <SeparatorHandle orientation="col" />
                </Separator>
                <Panel
                  id="task-code-rail"
                  className="hidden min-h-0 min-w-0 lg:flex"
                  defaultSize="36%"
                  minSize="280px"
                  maxSize="48%"
                >
                  <WorkspaceRail
                    changeCount={railController.changeCount ?? 0}
                    activeTab={railController.rail.activeTab}
                    pinned={railController.rail.pinned}
                    projectRoot={railController.effectiveProjectRoot}
                    familiarId={familiar.id}
                    sessionId={target.session.id}
                    focus={railController.focus}
                    onSelectTab={railController.rail.setActiveTab}
                    onTogglePin={railController.rail.togglePin}
                    onCollapse={railController.collapse}
                  />
                </Panel>
              </>
            ) : null}
          </Group>
        ) : target.kind === "preparing" && lookupState !== "missing" ? (
          <div className="task-work-cockpit__state" role="status">
            <Icon
              name={lookupState === "error" ? "ph:warning-circle" : "ph:circle-notch-bold"}
              width={18}
              className={lookupState === "error" ? undefined : "animate-spin"}
              aria-hidden
            />
            <strong>{lookupState === "error" ? "Couldn't check the work session" : "Preparing work session..."}</strong>
            <span>
              {lookupState === "error"
                ? "The task is still linked. Check the session again without leaving Tasks."
                : "The session started and will appear here when the workspace refresh completes."}
            </span>
            <button type="button" className="focus-ring" onClick={() => void refreshMissingSession()}>
              {lookupState === "error" ? "Try again" : "Refresh"}
            </button>
          </div>
        ) : (
          <div className="task-work-cockpit__state" role="alert">
            <Icon name="ph:warning-circle" width={18} aria-hidden />
            <strong>Work session unavailable</strong>
            <span>The linked session no longer exists. Unlink it to start fresh from this task.</span>
            {unlinkError ? <span role="alert">{unlinkError}</span> : null}
            <span className="task-work-cockpit__state-actions">
              <button type="button" className="focus-ring" onClick={() => void unlinkMissingSession()} disabled={unlinking}>
                {unlinking ? "Unlinking..." : "Unlink missing session"}
              </button>
              <button type="button" className="focus-ring" onClick={onOpenDetails}>
                Open task details
              </button>
            </span>
          </div>
        )}
      </div>
      {railController.rail.available
      && !railController.rail.open
      && !railController.isMobile
      && !railController.paneNarrow ? (
        <button
          type="button"
          aria-label="Show code rail"
          title="Show code rail"
          className="workspace-rail-reopen focus-ring"
          onClick={railController.rail.reopen}
        >
          <Icon name="ph:sidebar-simple" width={15} aria-hidden />
          <span className="workspace-rail-reopen__label">Code</span>
        </button>
      ) : null}
      <WorkspaceRailSheet controller={railController} familiar={familiar} sessionId={railSession?.id ?? null} />
    </section>
  );
}
