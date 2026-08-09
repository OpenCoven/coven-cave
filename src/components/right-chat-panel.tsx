"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/**
 * Shared frame for every loading/error/chooser state: a named `<aside>` plus
 * a header carrying a title and a Close action. The panel can render inside a
 * focus-trapped mobile modal, so every one of those states — not just the
 * fully resolved chat — must expose a discoverable way out instead of
 * trapping focus with no escape affordance.
 */
function RightChatPanelFrame({
  onClose,
  title = "Chat",
  children,
}: {
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="right-chat" aria-label="Chat panel">
      <header className="right-chat__header">
        <strong>{title}</strong>
        <button
          type="button"
          className="focus-ring right-chat__icon-button"
          aria-label="Close Chat panel"
          onClick={onClose}
        >
          <Icon name="ph:x" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
        </button>
      </header>
      {children}
    </aside>
  );
}

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
  // Session ids we've actually observed appear in the eligible roster at
  // least once. A freshly promoted session (null → id, reported the instant
  // ChatRouter starts a chat from a blank compose) can arrive here before the
  // `sessions` roster prop has been refetched to include it. Without this,
  // the ineligible-selection effect below would immediately mistake "not yet
  // in the roster" for "removed from the roster" and stomp the brand-new
  // session with a replacement. Gating reconciliation on prior observation
  // fixes that promotion race with no timing/delay hack — it also lets the
  // *same* effect correctly reconcile a genuine later removal (archive/
  // delete) of a session it did previously observe.
  const observedSessionIdsRef = useRef<Set<string>>(new Set());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const resolvedActiveFamiliar =
    resolvedFamiliars.find((familiar) => familiar.id === activeFamiliar?.id) ?? null;
  const eligibleSessions = useMemo(
    () => eligibleRightChatSessions(sessions, activeFamiliar?.id ?? null),
    [activeFamiliar?.id, sessions],
  );
  for (const session of eligibleSessions) observedSessionIdsRef.current.add(session.id);
  // True once this exact familiar's router has actually resolved/mounted —
  // independent of any *current* familiarsError/sessionsError. Lets a
  // transient roster refresh failure surface loading/error UI without
  // unmounting the already-live ChatRouter (transcript/stream/scroll), and
  // (via the gate on the first-resolution effect below) keeps a null,
  // not-yet-mounted router from ever being marked resolved.
  const hasResolvedRouter = activeFamiliar !== null && resolvedFamiliarRef.current === activeFamiliar.id;
  const { announce } = useAnnouncer();

  // ChatRouter can report a null active session organically — an in-place
  // archive (ChatView's onBack after the archive PATCH), a delete, or a
  // discarded empty voice pre-session — with no accompanying explicit action
  // from this panel. That null carries no session identity, so overwriting
  // `selectedSessionId` here would drop the very id the reconcile effect
  // below needs in order to detect the confirmed removal once the roster
  // refreshes and resolve the same familiar's latest session (or a new
  // compose). Every *explicit* transition to a blank compose (the New chat
  // button, the thread switcher's New chat option, and both resolution
  // effects when no session is left) already calls `setSelectedSessionId(null)`
  // itself at the moment it acts, so this handler only ever needs to forward
  // a real, non-null id.
  const handleActiveSessionChange = (sessionId: string | null) => {
    if (sessionId !== null) setSelectedSessionId(sessionId);
  };

  useEffect(() => {
    if (activeFamiliar) return;
    resolvedFamiliarRef.current = null;
    setSelectedSessionId(null);
  }, [activeFamiliar]);

  // First open (or a genuine familiar change): resolve that familiar's latest
  // eligible session, or start a familiar-bound blank compose. Deliberately a
  // no-op on same-familiar close/reopen — resolvedFamiliarRef already holds
  // this familiar's id, so a manual mid-conversation selection survives.
  // Gated on familiars *and* sessions readiness (loaded, error-free) so this
  // never fires — and never marks resolvedFamiliarRef resolved — on a render
  // where the router isn't actually mounted (routerRef would be null and the
  // resolution would silently no-op, permanently skipping the real one).
  useEffect(() => {
    if (!open || !activeFamiliar || !familiarsLoaded || familiarsError || !sessionsLoaded || sessionsError) return;
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
  }, [activeFamiliar, announce, familiarsError, familiarsLoaded, open, sessions, sessionsError, sessionsLoaded]);

  // If the selected session stops being eligible (deleted, archived, or
  // otherwise dropped from the visible list) re-resolve the same familiar's
  // latest remaining session, or fall back to a familiar-bound blank compose.
  // Never falls back to another familiar. Reconciles only ids previously
  // observed in the eligible roster (see observedSessionIdsRef above) so a
  // just-promoted session the roster hasn't caught up to yet is never
  // mistaken for one that was removed.
  useEffect(() => {
    if (!open || !activeFamiliar || !sessionsLoaded || sessionsError || !selectedSessionId) return;
    if (eligibleSessions.some((session) => session.id === selectedSessionId)) return;
    if (!observedSessionIdsRef.current.has(selectedSessionId)) return;
    const replacement = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (replacement) routerRef.current?.openSession(replacement);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(replacement);
  }, [activeFamiliar, eligibleSessions, open, selectedSessionId, sessions, sessionsError, sessionsLoaded]);

  if (!familiarsLoaded || !sessionsLoaded) {
    return (
      <RightChatPanelFrame onClose={props.onClose}>
        <div className="right-chat__loading" role="status">
          Loading Chat…
        </div>
      </RightChatPanelFrame>
    );
  }

  // Only blocks on a familiars-roster failure the first time this familiar's
  // router hasn't resolved yet — once resolved, hasResolvedRouter keeps the
  // mounted ChatRouter (and its transcript/stream/scroll) on screen through a
  // later transient failure instead of unmounting it into this ErrorState.
  if (familiarsError && !hasResolvedRouter) {
    return (
      <RightChatPanelFrame onClose={props.onClose}>
        <ErrorState
          compact
          headline="Couldn't load familiars"
          subtitle={familiarsError}
          actions={<Button onClick={props.onRetryFamiliars}>Retry</Button>}
        />
      </RightChatPanelFrame>
    );
  }

  if (!activeFamiliar) {
    return (
      <RightChatPanelFrame onClose={props.onClose}>
        <EmptyState
          compact
          icon="ph:users-three"
          headline="Choose a familiar"
          subtitle="The Chat panel won't choose one for you."
          actions={
            <div className="right-chat__familiar-grid">
              {resolvedFamiliars.map((familiar) => (
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
      </RightChatPanelFrame>
    );
  }

  // Same transient-vs-mounted distinction as familiarsError above.
  if (sessionsError && !hasResolvedRouter) {
    return (
      <RightChatPanelFrame onClose={props.onClose}>
        <ErrorState
          compact
          headline="Couldn't load chats"
          subtitle="Your conversations are still safe."
          actions={<Button onClick={props.onRetrySessions}>Retry</Button>}
        />
      </RightChatPanelFrame>
    );
  }

  const title =
    eligibleSessions.find((session) => session.id === selectedSessionId)?.title ?? "New chat";
  // Surfaced *alongside* the mounted router below rather than replacing it —
  // familiarsError/sessionsError already passed the blocking branches above
  // (hasResolvedRouter is true), so this is a transient refresh failure, not
  // a first-load failure, and must not disturb the live chat.
  const transientErrorHeadline = familiarsError
    ? "Couldn't refresh familiars"
    : sessionsError
      ? "Couldn't refresh chats"
      : null;

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
      {transientErrorHeadline ? (
        <ErrorState
          compact
          headline={transientErrorHeadline}
          subtitle={familiarsError ?? "Your conversations are still safe."}
          actions={
            <Button onClick={familiarsError ? props.onRetryFamiliars : props.onRetrySessions}>
              Retry
            </Button>
          }
        />
      ) : null}
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
          onActiveSessionChange={handleActiveSessionChange}
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
