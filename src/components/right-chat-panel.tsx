"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  eligibleRightChatSessions,
  resolveLatestRightChatSessionId,
} from "@/lib/right-chat-session";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  open: boolean;
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  sessions: SessionRow[];
  sessionsLoaded: boolean;
  sessionsError: boolean;
  familiarsLoaded: boolean;
  familiarsError: string | null;
  daemonRunning: boolean;
  onClose: () => void;
  onSetActiveFamiliar: (id: string | null) => void;
  onRetryFamiliars: () => void;
  onRetrySessions: () => void;
  onSessionStarted: () => void;
  onSessionsChanged: () => void;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenTask: (cardId: string) => void;
  onOpenUrl: (url: string) => void;
};

/**
 * Persistent, focused wrapper around the shared ChatRouter for the global
 * right Chat panel. Owns *only* which session the auxiliary router shows —
 * transcript, streaming, composer, attachments, send, citations, and tool
 * rendering all remain ChatRouter/ChatView's responsibility. Never forks that
 * logic; never restores generic companion-rail concepts such as a variant
 * "kind" enum, multiple tab surfaces, or a bare arbitrary-content slot.
 */
export function RightChatPanel(props: Props) {
  const {
    open,
    familiars,
    activeFamiliar,
    sessions,
    sessionsLoaded,
    sessionsError,
    familiarsLoaded,
    familiarsError,
    daemonRunning,
  } = props;
  const routerRef = useRef<ChatRouterHandle | null>(null);
  // Tracks which familiar's latest session we've already resolved for, so a
  // same-familiar close/reopen never clobbers a manual thread selection —
  // only an actual familiar change (or the very first open) re-resolves.
  const resolvedFamiliarRef = useRef<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const resolvedActiveFamiliar =
    resolvedFamiliars.find((familiar) => familiar.id === activeFamiliar?.id) ?? null;
  const eligibleSessions = useMemo(
    () => eligibleRightChatSessions(sessions, activeFamiliar?.id ?? null),
    [activeFamiliar?.id, sessions],
  );
  const { announce } = useAnnouncer();

  useEffect(() => {
    if (activeFamiliar) return;
    resolvedFamiliarRef.current = null;
    setSelectedSessionId(null);
  }, [activeFamiliar]);

  // First open (or a genuine familiar change): resolve that familiar's latest
  // eligible session, or start a familiar-bound blank compose. Deliberately a
  // no-op on same-familiar close/reopen — resolvedFamiliarRef already holds
  // this familiar's id, so a manual mid-conversation selection survives.
  useEffect(() => {
    if (!open || !activeFamiliar || !sessionsLoaded || sessionsError) return;
    if (resolvedFamiliarRef.current === activeFamiliar.id) return;
    resolvedFamiliarRef.current = activeFamiliar.id;
    const latestId = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (latestId) routerRef.current?.openSession(latestId);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(latestId);
    announce(
      latestId
        ? `${activeFamiliar.display_name} chat opened`
        : `New chat with ${activeFamiliar.display_name}`,
    );
  }, [activeFamiliar, announce, open, sessions, sessionsError, sessionsLoaded]);

  // If the selected session stops being eligible (deleted, archived, or
  // otherwise dropped from the visible list) re-resolve the same familiar's
  // latest remaining session, or fall back to a familiar-bound blank compose.
  // Never falls back to another familiar.
  useEffect(() => {
    if (!open || !activeFamiliar || !sessionsLoaded || sessionsError || !selectedSessionId) return;
    if (eligibleSessions.some((session) => session.id === selectedSessionId)) return;
    const replacement = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (replacement) routerRef.current?.openSession(replacement);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(replacement);
  }, [activeFamiliar, eligibleSessions, open, selectedSessionId, sessions, sessionsError, sessionsLoaded]);

  if (!familiarsLoaded || !sessionsLoaded) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <div className="right-chat__loading" role="status">
          Loading Chat…
        </div>
      </aside>
    );
  }

  if (familiarsError) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <ErrorState
          compact
          headline="Couldn't load familiars"
          subtitle={familiarsError}
          actions={<Button onClick={props.onRetryFamiliars}>Retry</Button>}
        />
      </aside>
    );
  }

  if (!activeFamiliar) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <header className="right-chat__header">
          <strong>Chat</strong>
          <button
            type="button"
            className="focus-ring right-chat__icon-button"
            aria-label="Close Chat panel"
            onClick={props.onClose}
          >
            <Icon name="ph:x" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
          </button>
        </header>
        <EmptyState
          compact
          icon="ph:users-three"
          headline="Choose a familiar"
          subtitle="The Chat panel won't choose one for you."
          actions={
            <div className="right-chat__familiar-grid">
              {familiars.map((familiar) => (
                <Button
                  key={familiar.id}
                  variant="secondary"
                  onClick={() => props.onSetActiveFamiliar(familiar.id)}
                >
                  {familiar.display_name}
                </Button>
              ))}
            </div>
          }
        />
      </aside>
    );
  }

  if (sessionsError && resolvedFamiliarRef.current !== activeFamiliar.id) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <ErrorState
          compact
          headline="Couldn't load chats"
          subtitle="Your conversations are still safe."
          actions={<Button onClick={props.onRetrySessions}>Retry</Button>}
        />
      </aside>
    );
  }

  const title =
    eligibleSessions.find((session) => session.id === selectedSessionId)?.title ?? "New chat";

  return (
    <aside className="right-chat" aria-label="Chat panel" data-session-id={selectedSessionId ?? "new"}>
      <header className="right-chat__header">
        {resolvedActiveFamiliar ? <FamiliarAvatar familiar={resolvedActiveFamiliar} size="sm" /> : null}
        <span className="right-chat__identity">
          <strong>{activeFamiliar.display_name}</strong>
          <span title={title}>{title}</span>
        </span>
        <select
          className="focus-ring right-chat__thread-switcher"
          aria-label="Switch Chat panel thread"
          value={selectedSessionId ?? "__new__"}
          onChange={(event) => {
            const nextId = event.currentTarget.value;
            if (nextId === "__new__") {
              routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
              setSelectedSessionId(null);
              announce(`New chat with ${activeFamiliar.display_name}`);
              return;
            }
            routerRef.current?.openSession(nextId);
            setSelectedSessionId(nextId);
            const nextSession = eligibleSessions.find((session) => session.id === nextId);
            announce(`${nextSession ? sessionRailTitle(nextSession) : "Chat"} opened`);
          }}
        >
          <option value="__new__">New chat</option>
          {eligibleSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {sessionRailTitle(session)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="focus-ring right-chat__icon-button"
          aria-label="New Chat panel chat"
          onClick={() => {
            routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
            setSelectedSessionId(null);
            announce(`New chat with ${activeFamiliar.display_name}`);
          }}
        >
          <Icon name="ph:plus" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
        </button>
        <button
          type="button"
          className="focus-ring right-chat__icon-button"
          aria-label="Close Chat panel"
          onClick={props.onClose}
        >
          <Icon name="ph:x" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
        </button>
      </header>
      <div className="right-chat__content">
        <ChatRouter
          ref={routerRef}
          familiar={activeFamiliar}
          familiars={familiars}
          sessions={sessions}
          daemonRunning={daemonRunning}
          sessionsLoaded={sessionsLoaded}
          sessionsError={sessionsError}
          familiarsLoaded={familiarsLoaded}
          familiarsError={familiarsError}
          onRetryFamiliars={props.onRetryFamiliars}
          onSetActiveFamiliar={props.onSetActiveFamiliar}
          onSessionStarted={props.onSessionStarted}
          onSessionsChanged={props.onSessionsChanged}
          onSessionsDeleted={props.onSessionsDeleted}
          onSlashFromChat={props.onSlashFromChat}
          onOpenOnboarding={props.onOpenOnboarding}
          onOpenTask={props.onOpenTask}
          onOpenUrl={props.onOpenUrl}
          onActiveSessionChange={setSelectedSessionId}
          composerDraftKey={`cave:right-chat-composer-draft:v1:${activeFamiliar.id}`}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
          activeFamiliarId={activeFamiliar.id}
        />
      </div>
    </aside>
  );
}
