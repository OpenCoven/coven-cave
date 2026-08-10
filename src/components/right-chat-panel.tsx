"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  // Tracks which familiar's latest session has actually been RESOLVED (an
  // imperative openSession/newChat call issued and selectedSessionId set to
  // match), so a same-familiar close/reopen never clobbers a manual thread
  // selection — only an actual familiar change re-resolves. Only ever set to
  // a familiar id by an actual resolve, which only happens while `open`
  // (cave-rl980 Task 4 spec review: first-open semantics require resolving
  // against whichever session is newest at the moment the panel actually
  // becomes visible, never one resolved earlier while hidden). Invalidated
  // back to null — regardless of `open` — the instant trackedFamiliarIdRef
  // below detects a transition, so a closed familiar change still forces a
  // fresh resolve once the panel actually reopens.
  const resolvedFamiliarRef = useRef<string | null>(null);
  // The familiar id this panel is currently tracking, updated on EVERY
  // activeFamiliar change regardless of `open` or whether a resolve actually
  // happened — its only job is detecting that a transition occurred at all,
  // even a closed A -> B -> A round trip that lands back on a familiar id
  // resolvedFamiliarRef would otherwise still (wrongly) appear to agree
  // with, since resolvedFamiliarRef itself is never touched while closed.
  // Whenever this disagrees with the incoming activeFamiliar.id, the
  // resolution effect below invalidates resolvedFamiliarRef and the current
  // selection — regardless of `open` — so the closed round trip is still
  // detected the instant the panel reopens (cave-rl980 Task 4 spec review).
  const trackedFamiliarIdRef = useRef<string | null>(null);
  // Session ids we've actually observed appear in the eligible roster at
  // least once. A freshly promoted session (null → id, reported the instant
  // ChatRouter starts a chat from a blank compose) can arrive here before the
  // `sessions` roster prop has been refetched to include it. Without this,
  // the reconcile branch below would immediately mistake "not yet in the
  // roster" for "removed from the roster" and stomp the brand-new session
  // with a replacement. Gating reconciliation on prior observation fixes
  // that promotion race with no timing/delay hack — it also lets the *same*
  // branch correctly reconcile a genuine later removal (archive/delete) of a
  // session it did previously observe. Committed from an effect below, never
  // inline during render (cave-rl980 Task 4 review): a render React abandons
  // before commit must never leave a mark here.
  const observedSessionIdsRef = useRef<Set<string>>(new Set());
  // Armed the instant handleSessionRemoved below runs, consumed (read, then
  // reset) by the very next handleActiveSessionChange report of any kind.
  // handleSessionRemoved is ChatView's own narrow, purpose-built removal
  // signal (see its `onSessionRemoved` doc in chat-view.tsx) — fired only for
  // a confirmed archive/delete/discard of the exact session this panel is
  // showing, and always immediately followed, synchronously in the same
  // tick, by the null that navigates away (onBack, or onVoiceSessionDiscarded
  // for a discarded pre-session). Deliberately NOT armed by the generic
  // onSessionsChanged/onSessionsDeleted refresh callbacks: those also fire
  // for refreshes that have nothing to do with THIS session's removal (a
  // canonical-session reconcile after a stream settles, a *different*
  // thread auto-archiving on reflection, a Board handoff refresh, …), so
  // treating their firing as a removal signal would misclassify an ordinary
  // "Back to sessions" that merely happens to land after one of those
  // unrelated refreshes (cave-rl980 Task 4 review).
  const pendingRemovalRef = useRef(false);
  // Synchronously mirrors the current selection — this panel's active
  // familiar id and selected session id — the instant either commits (see
  // the layout effect below, deliberately unguarded by familiarsError/
  // sessionsError/open so it never lags behind the actual render). Read by
  // handleSessionRemoved below INSTEAD OF the selectedSessionId/activeFamiliar
  // closed over at that particular function instance's own creation render.
  // archiveChat/deleteChat/setChatArchived/discardVoiceSessionIfEmpty are all
  // async: the specific onSessionRemoved callback ChatView's in-flight
  // request actually invokes is whichever one was current when THAT request
  // began, frozen at whatever selectedSessionId/activeFamiliar existed then —
  // and stays frozen even after the user switches to a different thread or
  // familiar while the request is still in flight. Comparing against this
  // ref instead means the check always sees the LATEST truth, regardless of
  // how stale the invoked closure is (cave-rl980 Task 4 final review).
  const currentSelectionRef = useRef<{ familiarId: string | null; sessionId: string | null }>({
    familiarId: null,
    sessionId: null,
  });
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

  // Commits currentSelectionRef the instant either half changes — a plain
  // useLayoutEffect with no early-return guard, unlike the big resolution
  // effect below, so it can never lag behind the actual rendered selection
  // during a familiarsError/sessionsError/closed state.
  useLayoutEffect(() => {
    currentSelectionRef.current = { familiarId: activeFamiliar?.id ?? null, sessionId: selectedSessionId };
  }, [activeFamiliar, selectedSessionId]);

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
  // removal (archive/delete's onBack, or a discarded empty voice
  // pre-session's onVoiceSessionDiscarded). The first must clear the stale
  // selection immediately. The second must retain it long enough for the
  // roster itself to confirm the removal (the same-familiar reconcile branch
  // below replaces it once `sessions` actually drops it) instead of flashing
  // "New chat" the instant this fires, ahead of the roster actually catching
  // up — UNLESS the removed session was never observed in the eligible
  // roster at all (a promoted/voice session discarded before the roster ever
  // caught up to it), in which case there is no future "roster confirms
  // removal" transition to wait for, so a replacement is resolved
  // immediately instead (cave-rl980 Task 4 spec review).
  //
  // pendingRemovalRef — armed only by handleSessionRemoved, below, for the
  // exact session it names — distinguishes the two. Explicit New chat
  // actions (the button, the thread switcher, and both resolution branches
  // below) bypass this handler entirely — they already call
  // setSelectedSessionId(null) directly at the moment they act.
  const handleActiveSessionChange = (sessionId: string | null) => {
    const removalConfirmed = pendingRemovalRef.current;
    pendingRemovalRef.current = false;
    if (sessionId !== null) {
      setSelectedSessionId(sessionId);
      return;
    }
    const removedId = currentSelectionRef.current.sessionId;
    if (removalConfirmed && removedId !== null) {
      if (observedSessionIdsRef.current.has(removedId)) {
        // Previously observed eligible: retain the stale selection until the
        // roster itself confirms the removal — there IS a real future
        // transition to wait for here.
        return;
      }
      // Confirmed removed by ChatView's own onSessionRemoved signal, but
      // NEVER observed in the eligible roster: there is no future "roster
      // confirms removal" transition to wait for (it was never eligible to
      // begin with), so resolve a replacement immediately instead of leaving
      // the panel stuck on a ghost session forever. Excludes the removed id
      // explicitly in case a stale `sessions` snapshot still lists it.
      if (activeFamiliar) {
        const replacement = resolveLatestRightChatSessionId(
          sessions.filter((session) => session.id !== removedId),
          activeFamiliar.id,
        );
        if (replacement) routerRef.current?.openSession(replacement);
        else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
        setSelectedSessionId(replacement);
        return;
      }
    }
    setSelectedSessionId(null);
  };

  // Arms pendingRemovalRef whenever the removed session is STILL the one
  // this panel currently has selected, for the same familiar. Sourced from
  // ChatView's own onSessionRemoved (see its doc), fired only at the exact
  // archive/delete/discard call sites, never inferred from
  // onSessionsChanged/onSessionsDeleted — those are forwarded to ChatRouter
  // entirely unwrapped below, preserving their existing behavior for every
  // other consumer instead of intercepting every call to guess at removal.
  //
  // Deliberately NOT gated on observedSessionIdsRef (cave-rl980 Task 4 spec
  // review): onSessionRemoved is authoritative on its own — ChatView only
  // ever fires it for a CONFIRMED archive/delete/discard of the exact
  // session named, so a session promoted and removed before the `sessions`
  // roster prop ever caught up to include it is just as real a removal as
  // one the roster had already shown. handleActiveSessionChange above is
  // what decides HOW to react to that confirmation (retain-and-wait vs.
  // resolve-immediately) based on whether the id was ever observed; the
  // observed gate still protects the DIFFERENT, unsignaled case there — an
  // ordinary roster refresh where an id merely hasn't appeared yet (a
  // promotion race with no removal signal at all).
  //
  // Deliberately reads currentSelectionRef, NOT the selectedSessionId/
  // activeFamiliar closed over by this exact function instance: this
  // specific handleSessionRemoved is whichever one ChatView's async
  // archive/delete/discard request captured when IT began, and by the time
  // that request settles the user may have already switched to a different
  // thread or familiar. Comparing the removed id against a frozen selection
  // from before the switch would incorrectly arm retention for a session
  // nobody is looking at anymore; the ref always reflects the CURRENT truth
  // instead (cave-rl980 Task 4 final review). A single sessionId comparison
  // against the ref already covers "for the same familiar" too — a session
  // id is only ever the panel's selectedSessionId while its owning familiar
  // is active (see the activeFamiliar-cleared effect above and the
  // resolution effect below, which never carries a selection across a
  // familiar change), so currentSelectionRef.sessionId can equal
  // removedSessionId only when currentSelectionRef.familiarId is the
  // familiar that removal actually happened under.
  const handleSessionRemoved = (removedSessionId: string) => {
    const current = currentSelectionRef.current;
    if (current.sessionId !== removedSessionId) return;
    pendingRemovalRef.current = true;
  };

  useEffect(() => {
    if (activeFamiliar) return;
    resolvedFamiliarRef.current = null;
    pendingRemovalRef.current = false;
    setSelectedSessionId(null);
  }, [activeFamiliar]);

  // Resolves the active familiar's latest eligible session (or starts a
  // familiar-bound blank compose) on first open and on every subsequent
  // familiar change, and reconciles the selection when it stops being
  // eligible for the SAME familiar (archived/deleted). One `useLayoutEffect`
  // handling both, not two separate effects (cave-rl980 Task 4 review — see
  // the reasons below):
  //
  // 1. Every familiar-identity TRANSITION is tracked via trackedFamiliarIdRef
  //    regardless of `open` — ChatRouter/ChatView stay mounted underneath as
  //    a persistent controller, per the design doc, so a familiar change must
  //    be noticed even while hidden. A closed A -> B -> A round trip must
  //    still invalidate whatever was resolved for the earlier A: without
  //    this tracking, coming back to A would find resolvedFamiliarRef still
  //    reading "A" (never touched while closed) and wrongly conclude nothing
  //    had changed. But the actual RESOLVE — the imperative
  //    openSession/newChat call, and setting selectedSessionId — is a
  //    completely separate, `open`-gated step (cave-rl980 Task 4 spec
  //    review): first-open semantics require resolving against whichever
  //    session is newest at the moment the panel actually becomes visible,
  //    never one resolved earlier while hidden. So a closed transition
  //    invalidates ownership here but issues no router call at all; this
  //    same effect performs the real resolve — against live, then-current
  //    `sessions` — the instant `open` flips true, since `open` is itself a
  //    dependency below. A same-familiar close/reopen (no transition at all)
  //    never invalidates anything, so it preserves a manual thread
  //    selection exactly as before.
  // 2. A familiar change must issue EXACTLY ONE imperative openSession/
  //    newChat call while open. Splitting this into two effects (one keyed
  //    on the familiar changing, a second reconciling an ineligible
  //    selection) races them: on the very render the familiar changes, a
  //    second, separate effect would still see the OUTGOING familiar's stale
  //    `selectedSessionId` — never eligible for the new familiar's
  //    `eligibleSessions`, and (having been observed under the old familiar)
  //    passing the observed-gate too — so it would ALSO reconcile, firing a
  //    second, redundant action. Handling "familiar changed" first and
  //    returning keeps that stale selection from ever reaching the
  //    eligibility check below; only a same-familiar removal reaches it.
  //    `useLayoutEffect`, not `useEffect`, so this also wins the ordering
  //    race against ChatRouter's own internal familiar-switch effect (a
  //    passive effect): every layout effect across the tree commits before
  //    any passive effect runs, so by the time ChatRouter's own effect sees
  //    the new familiar, the view it reads back is already the one this
  //    effect just set — its own transition becomes a same-value no-op
  //    instead of a second, independently guessed one.
  useLayoutEffect(() => {
    if (!activeFamiliar || !familiarsLoaded || familiarsError || !sessionsLoaded || sessionsError) return;

    if (trackedFamiliarIdRef.current !== activeFamiliar.id) {
      // A transition just occurred — possibly back to a familiar visited
      // earlier in the same closed stretch (closed A -> B -> A) — so
      // whatever resolution/selection ownership was previously recorded
      // belongs to a different occupancy and must never be trusted for this
      // one, regardless of `open`.
      trackedFamiliarIdRef.current = activeFamiliar.id;
      resolvedFamiliarRef.current = null;
      pendingRemovalRef.current = false;
      setSelectedSessionId(null);
    }

    if (resolvedFamiliarRef.current !== activeFamiliar.id) {
      // First open, or a genuine familiar change: needs a fresh resolve.
      // Never touch the router or the selection while the panel is closed
      // (cave-rl980 Task 4 spec review) — leave ownership unresolved and let
      // this same effect resolve it, against live sessions data, the moment
      // `open` flips true.
      if (!open) return;
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
      return;
    }
    // Same, already-resolved familiar: only reconcile if the selected
    // session stopped being eligible (deleted, archived, or otherwise
    // dropped from the visible list) — and only an id previously observed in
    // the eligible roster (see observedSessionIdsRef above), so a
    // just-promoted session the roster hasn't caught up to yet is never
    // mistaken for one that was removed. Never falls back to another
    // familiar.
    if (!selectedSessionId) return;
    if (eligibleSessions.some((session) => session.id === selectedSessionId)) return;
    if (!observedSessionIdsRef.current.has(selectedSessionId)) return;
    const replacement = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (replacement) routerRef.current?.openSession(replacement);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(replacement);
  }, [activeFamiliar, announce, eligibleSessions, familiarsError, familiarsLoaded, open, selectedSessionId, sessions, sessionsError, sessionsLoaded]);

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
          onSessionRemoved={handleSessionRemoved}
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
