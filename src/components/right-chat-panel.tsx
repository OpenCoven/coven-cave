"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StandardSelect } from "@/components/ui/select";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { FocusTrapOwnerHiddenContext } from "@/lib/use-focus-trap";
import {
  eligibleRightChatSessions,
  isCurrentRightChatSessionsScope,
  resolveLatestRightChatSessionId,
  type RightChatSessionsScope,
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
 *
 * `open` is truthful accessibility, not a mount gate (cave-rl980 Task 4
 * review): Shell keeps this panel mounted while closed (collapsed/hidden via
 * CSS) so ChatRouter's transcript/stream/scroll/draft survive a close —
 * "Keep the router mounted" per the design doc — but a persistently-mounted,
 * merely visually-collapsed root is otherwise still in the tab order and the
 * accessibility tree, so a sighted mouse user sees nothing while a keyboard
 * or screen-reader user can still Tab into (and activate) hidden Retry/Close/
 * New-chat controls or land on hidden chat content. `aria-hidden` + `inert`
 * together (the same pair `code-terminal-drawer.tsx` uses for its own
 * "hidden rather than unmounted" drawer) make every frame/root truthfully
 * absent from both when `open` is false, while an `open` state stays fully
 * accessible.
 *
 * `FocusTrapOwnerHiddenContext.Provider value={!open}` (cave-rl980 Task 5
 * finding #2) covers the gap `inert` alone leaves open: `inert` is a DOM
 * attribute, so it only reaches DESCENDANTS in the DOM tree — but a child
 * dialog rendered from deep inside `children` (e.g. ChatRouter's transcript
 * opening ChatArtifactViewer's fullscreen view, ChatSpecCard, or
 * ImageCarousel's lightbox) portals to `document.body` directly via
 * `createPortal`, landing as a DOM SIBLING of this `<aside>`, never a
 * descendant — so this element's own `inert` never reaches it. The context
 * still does, because `createPortal` only relocates the DOM node; it never
 * changes REACT ancestry. Every one of those dialogs already calls
 * `useFocusTrap`, which consumes this context automatically, so closing this
 * panel now asks any such still-open child to close too, through the SAME
 * onEscape callback it already wires up for the Escape key — no DOM
 * relocation hack, no new event bus, no changes needed to any of those
 * components themselves.
 */
function RightChatPanelFrame({
  open,
  onClose,
  title = "Chat",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="right-chat" aria-label="Chat panel" aria-hidden={!open} inert={!open}>
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
      <FocusTrapOwnerHiddenContext.Provider value={!open}>{children}</FocusTrapOwnerHiddenContext.Provider>
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
  /**
   * Applied-session-scope contract (cave-rl980 Task 4 review): the familiar
   * id the CALLER currently guarantees `sessions` reflects. Workspace's own
   * session list is fetched scoped to a single active familiar and refetches
   * asynchronously on every familiar switch (see `loadSessions` in
   * workspace.tsx), so `sessions` can still hold the OUTGOING familiar's rows
   * for a render or more after `activeFamiliar` itself has already flipped —
   * resolving eagerly against it would risk opening a blank compose for a
   * familiar that actually has chats, or the reverse. Omit this prop (or
   * pass `undefined`) until Workspace tracks and supplies its own applied
   * scope (Task 7 wires it): `sessions` is then trusted as already current,
   * preserving this contract exactly for every caller that hasn't adopted
   * it yet. See `isCurrentRightChatSessionsScope` in right-chat-session.ts.
   */
  sessionsScopeFamiliarId?: RightChatSessionsScope;
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
  onOpenPreview?: (url: string) => void;
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
    sessionsScopeFamiliarId,
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
  // True once `sessions` is confirmed to correspond to the active familiar
  // (cave-rl980 Task 4 review — see isCurrentRightChatSessionsScope's doc in
  // right-chat-session.ts). Always true while the caller hasn't adopted the
  // applied-scope contract yet (sessionsScopeFamiliarId left undefined),
  // preserving today's behavior exactly until Workspace wires it (Task 7).
  const sessionsScopeCurrent =
    activeFamiliar === null ||
    isCurrentRightChatSessionsScope(sessionsScopeFamiliarId, activeFamiliar.id);
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
  // 1. Familiar-identity tracking/invalidation happens FIRST, unconditional
  //    on familiars/sessions readiness or errors (cave-rl980 Task 4 review):
  //    a closed A -> B -> A round trip must still be detected as a real
  //    transition even while a roster error is active throughout, or
  //    trackedFamiliarIdRef would never advance past the ORIGINAL A, and the
  //    later return to A would be mistaken for "nothing changed" — silently
  //    retaining A's stale resolution once the error clears and the panel
  //    reopens, instead of forcing the fresh resolve a real transition
  //    requires. Every familiar-identity TRANSITION is tracked via
  //    trackedFamiliarIdRef regardless of `open` too — ChatRouter/ChatView
  //    stay mounted underneath as a persistent controller, per the design
  //    doc, so a familiar change must be noticed even while hidden. But the
  //    actual RESOLVE — the imperative openSession/newChat call, and setting
  //    selectedSessionId — remains a separate, readiness/scope/`open`-gated
  //    step below: first-open semantics require resolving against whichever
  //    session is newest at the moment the panel actually becomes visible,
  //    never one resolved earlier while hidden or against stale data. So a
  //    closed, erroring, or not-yet-scoped transition invalidates ownership
  //    here but issues no router call at all; this same effect performs the
  //    real resolve once every gate clears, since each gate is itself a
  //    dependency below. A same-familiar close/reopen (no transition at all)
  //    never invalidates anything, so it preserves a manual thread selection
  //    exactly as before.
  // 2. The resolve/reconcile itself additionally requires `sessions` to be
  //    CONFIRMED to reflect this exact familiar (cave-rl980 Task 4 review):
  //    Workspace's own session list is fetched scoped to a single active
  //    familiar and refetches asynchronously on every switch, so `sessions`
  //    can still hold the OUTGOING familiar's rows for a render or more
  //    after `activeFamiliar` itself has already changed. Resolving against
  //    it regardless would risk opening a blank compose for a familiar that
  //    actually has chats, or the reverse. See sessionsScopeCurrent (derived
  //    above via isCurrentRightChatSessionsScope in right-chat-session.ts) —
  //    omitting sessionsScopeFamiliarId (Task 7 has not wired Workspace's own
  //    scope yet) always reports current, so this gate is a no-op until then.
  // 3. A familiar change must issue EXACTLY ONE imperative openSession/
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
    if (!activeFamiliar) return;

    if (trackedFamiliarIdRef.current !== activeFamiliar.id) {
      // A transition just occurred — possibly back to a familiar visited
      // earlier in the same closed stretch (closed A -> B -> A), or one that
      // happened entirely while familiars/sessions were erroring — so
      // whatever resolution/selection ownership was previously recorded
      // belongs to a different occupancy and must never be trusted for this
      // one, regardless of `open`, readiness, errors, or scope.
      trackedFamiliarIdRef.current = activeFamiliar.id;
      resolvedFamiliarRef.current = null;
      pendingRemovalRef.current = false;
      setSelectedSessionId(null);
    }

    if (!familiarsLoaded || familiarsError || !sessionsLoaded || sessionsError) return;
    if (!sessionsScopeCurrent) return;

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
  }, [activeFamiliar, announce, eligibleSessions, familiarsError, familiarsLoaded, open, selectedSessionId, sessions, sessionsError, sessionsLoaded, sessionsScopeCurrent]);

  // Blocks rendering — including ChatRouter's own mount — while the active
  // familiar's sessions scope hasn't been confirmed yet, for a familiar that
  // has never resolved before (cave-rl980 Task 4 review). Merely skipping
  // RightChatPanel's own resolve effect above is not enough on its own:
  // ChatRouter/ChatView already flip to a fresh, familiar-bound blank
  // compose the instant their own `familiar` prop changes (their own
  // internal familiar-switch effect), independent of whether this component
  // ever calls openSession/newChat. Keeping ChatRouter unmounted until scope
  // is confirmed — the same treatment as the plain loading gate below —
  // means it never even sees the new familiar until the effect above is
  // ready to resolve it in the very same commit, so no early blank or
  // stale-familiar flash is ever rendered. hasResolvedRouter still protects
  // a LATER, transient scope hiccup for an already-showing familiar exactly
  // like familiarsError/sessionsError below.
  //
  // An unconfirmed scope stops blocking the instant `sessionsError` is true
  // (cave-rl980 Task 4 review, final finding): the caller's fetch for the
  // scope this exact familiar needs has already failed outright — there is
  // no future "scope applies" transition left to wait quietly for, only a
  // real failure to report — so falling through here lets the sessionsError
  // branch below render the explicit "Couldn't load chats" ErrorState with
  // Retry instead of an indefinite spinner nothing will ever clear. A scope
  // that is merely still pending (no error yet) is untouched by this and
  // keeps rendering Loading exactly as before — first-resolution safety
  // never resolves against a roster that hasn't actually confirmed it
  // belongs to this familiar.
  if (
    !familiarsLoaded ||
    !sessionsLoaded ||
    (activeFamiliar !== null && !sessionsScopeCurrent && !hasResolvedRouter && !sessionsError)
  ) {
    return (
      <RightChatPanelFrame onClose={props.onClose} open={open}>
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
      <RightChatPanelFrame onClose={props.onClose} open={open}>
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
      <RightChatPanelFrame onClose={props.onClose} open={open}>
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

  // Same transient-vs-mounted distinction as familiarsError above. Also the
  // fallback for the stale-scope-plus-fetch-failure case carved out of the
  // loading gate above: it reaches here unconditional on sessionsScopeCurrent.
  if (sessionsError && !hasResolvedRouter) {
    return (
      <RightChatPanelFrame onClose={props.onClose} open={open}>
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
    <aside
      className="right-chat"
      aria-label="Chat panel"
      // Truthful accessibility for the persistently-mounted root, same
      // rationale as RightChatPanelFrame's own doc above: closed means out of
      // both the tab order and the accessibility tree, never merely
      // invisible; open stays fully accessible.
      aria-hidden={!open}
      inert={!open}
      data-session-id={selectedSessionId ?? "new"}
    >
      <header className="right-chat__header">
        {resolvedActiveFamiliar ? <FamiliarAvatar familiar={resolvedActiveFamiliar} size="sm" /> : null}
        <span className="right-chat__identity">
          <strong>{activeFamiliar.display_name}</strong>
          <span title={title}>{title}</span>
        </span>
        <StandardSelect
          className="right-chat__thread-switcher"
          label="Switch Chat panel thread"
          value={selectedSessionId ?? "__new__"}
          onChange={(nextId) => {
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
          options={[
            { value: "__new__", label: "New chat" },
            ...eligibleSessions.map((session) => ({
              value: session.id,
              label: sessionRailTitle(session),
            })),
          ]}
        />
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
      {/*
        FocusTrapOwnerHiddenContext.Provider value={!open} (cave-rl980 Task 5
        finding #2) — see RightChatPanelFrame's doc comment above for the
        full rationale. This is the branch that actually mounts ChatRouter,
        so it's the one that matters most: a still-open ChatArtifactViewer
        fullscreen view, ChatSpecCard, or ImageCarousel lightbox opened from
        the transcript below is asked to close the instant this panel
        becomes hidden/inert, through its own existing onEscape callback.
      */}
      <FocusTrapOwnerHiddenContext.Provider value={!open}>
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
            onOpenPreview={props.onOpenPreview}
            onActiveSessionChange={handleActiveSessionChange}
            composerDraftKey={`cave:right-chat-composer-draft:v1:${activeFamiliar.id}`}
            compact
            hideRail
            syncUrlHash={false}
            enableSplitPanes={false}
            activeFamiliarId={activeFamiliar.id}
          />
        </div>
      </FocusTrapOwnerHiddenContext.Provider>
    </aside>
  );
}
