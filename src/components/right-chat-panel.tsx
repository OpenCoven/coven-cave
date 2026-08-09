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
  // delete) of a session it did previously observe. Committed from an effect
  // below, never inline during render (cave-rl980 Task 4 review): a render
  // React abandons before commit must never leave a mark here.
  const observedSessionIdsRef = useRef<Set<string>>(new Set());
  // Armed the instant handleSessionsChanged/handleSessionsDeleted below run,
  // consumed (read, then reset) by the very next handleActiveSessionChange
  // report of any kind. ChatView calls exactly one of those two mutation
  // callbacks and then, synchronously in the same tick, either onBack or
  // onVoiceSessionDiscarded for every confirmed archive, delete, and
  // discarded voice pre-session — never for an ordinary back navigation
  // (e.g. "Back to sessions" on a transcript-history load failure). That
  // order is the only signal available here for "this null follows a real
  // roster mutation" versus "this null is just the user navigating away."
  const pendingRemovalRef = useRef(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const resolvedActiveFamiliar =
    resolvedFamiliars.find((familiar) => familiar.id === activeFamiliar?.id) ?? null;
  const eligibleSessions = useMemo(
    () => eligibleRightChatSessions(sessions, activeFamiliar?.id ?? null),
    [activeFamiliar?.id, sessions],
  );
  // True once this exact familiar's router has actually resolved/mounted —
  // independent of any *current* familiarsError/sessionsError. Lets a
  // transient roster refresh failure surface loading/error UI without
  // unmounting the already-live ChatRouter (transcript/stream/scroll), and
  // (via the gate on the first-resolution effect below) keeps a null,
  // not-yet-mounted router from ever being marked resolved.
  const hasResolvedRouter = activeFamiliar !== null && resolvedFamiliarRef.current === activeFamiliar.id;
  const { announce } = useAnnouncer();

  // Fold the current eligible roster into the observed-ids record after
  // commit, not inline during render (cave-rl980 Task 4 review): an id only
  // ever needs to be *in* this set once its owning render has actually
  // landed, since the reconcile effects below only ever consult it for an id
  // that is absent from the *current* eligibleSessions — which, if it was
  // ever eligible, was necessarily recorded by an earlier, already-committed
  // render's copy of this same effect.
  useEffect(() => {
    for (const session of eligibleSessions) observedSessionIdsRef.current.add(session.id);
  }, [eligibleSessions]);

  // ChatRouter reports a null active session in two shapes that read
  // identically from here (both simply become `activeSessionId: null`): an
  // ordinary "list" transition (the ChatHistoryNotice "Back to sessions"
  // affordance after a transcript load failure — the session itself is still
  // fully eligible; only its transcript failed to fetch) and a genuine
  // removal (archive's onBack after the PATCH, delete's onBack after the
  // DELETE, or a discarded empty voice pre-session's onVoiceSessionDiscarded).
  // The first must clear the stale selection immediately. The second must
  // retain it long enough for the reconcile effect below to confirm the
  // removal once the roster refreshes and resolve the same familiar's latest
  // session (or a new compose) instead of flashing "New chat" the instant
  // this fires, ahead of the roster actually catching up.
  //
  // pendingRemovalRef — armed by handleSessionsChanged/handleSessionsDeleted,
  // exactly the two calls every removal path makes immediately before its
  // null — distinguishes the two. That alone is not sufficient, though: a
  // discarded voice pre-session also reports through onSessionsChanged
  // (discardVoiceSessionIfEmpty refreshes the list once the empty session is
  // deleted server-side) despite never having appeared in the roster to
  // begin with. Retaining that id would leave a permanent ghost — the
  // reconcile effect's own observed-gate can never confirm the removal of an
  // id the roster never listed in the first place. Requiring the id to have
  // been previously observed eligible closes that gap: only a real,
  // previously visible session is ever retained; a discarded, never-observed
  // promotion clears just like an ordinary back. Explicit New chat actions
  // (the button, the thread switcher, and both resolution effects) bypass
  // this handler entirely — they already call setSelectedSessionId(null)
  // directly at the moment they act.
  const handleActiveSessionChange = (sessionId: string | null) => {
    const removalConfirmed = pendingRemovalRef.current;
    pendingRemovalRef.current = false;
    if (sessionId !== null) {
      setSelectedSessionId(sessionId);
      return;
    }
    setSelectedSessionId((prev) =>
      removalConfirmed && prev !== null && observedSessionIdsRef.current.has(prev) ? prev : null,
    );
  };

  // Arms pendingRemovalRef for the very next handleActiveSessionChange report,
  // then forwards to the real callback unchanged — RightChatPanel observes
  // the mutation, it never forks it.
  const handleSessionsChanged = () => {
    pendingRemovalRef.current = true;
    props.onSessionsChanged();
  };
  const handleSessionsDeleted = (sessionIds: readonly string[]) => {
    pendingRemovalRef.current = true;
    props.onSessionsDeleted(sessionIds);
  };

  useEffect(() => {
    if (activeFamiliar) return;
    resolvedFamiliarRef.current = null;
    pendingRemovalRef.current = false;
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
          onSessionsChanged={handleSessionsChanged}
          onSessionsDeleted={handleSessionsDeleted}
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
