// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./right-chat-panel.tsx", import.meta.url), "utf8");

assert.match(source, /<aside[^>]+aria-label="Chat panel"/, "desktop content is a named complementary landmark");
assert.match(
  source,
  /compact[\s\S]*hideRail[\s\S]*syncUrlHash=\{false\}[\s\S]*enableSplitPanes=\{false\}/,
  "the auxiliary router remains compact, hash-neutral, and single-pane",
);
assert.match(
  source,
  /composerDraftKey=\{`cave:right-chat-composer-draft:v1:\$\{activeFamiliar\.id\}`\}/,
  "each familiar keeps an auxiliary-only draft",
);
assert.match(
  source,
  /resolveLatestRightChatSessionId\(sessions, activeFamiliar\.id\)/,
  "initial and familiar-change resolution uses the canonical helper",
);
assert.match(
  source,
  /resolvedFamiliarRef\.current === activeFamiliar\.id/,
  "same-familiar reopen does not replace manual thread selection",
);
assert.match(
  source,
  /routerRef\.current\?\.newChat\(undefined, undefined, activeFamiliar\.id\)/,
  "no eligible chat opens a familiar-bound blank compose",
);
// The switcher is the design system's StandardSelect, whose `label` prop
// becomes the trigger button's aria-label — a native <select> here would trip
// the `components/no-native-select` drift ratchet.
assert.match(
  source,
  /<StandardSelect\b[\s\S]*?label="Switch Chat panel thread"/,
  "the compact header exposes a labelled thread switcher",
);
assert.doesNotMatch(source, /<select\b/, "the thread switcher never regresses to a native select");
assert.match(source, /aria-label="New Chat panel chat"/, "the compact header exposes New chat");
assert.match(source, /aria-label="Close Chat panel"/, "the compact header exposes Close");
assert.doesNotMatch(
  source,
  /RightPanelKind|companionTabs|agent\?: ReactNode/,
  "the dedicated wrapper does not restore generic companion concepts",
);

// Applied-session-scope contract (cave-rl980 Task 4 review, bullet 1): the
// narrowest explicit contract that lets a future caller (Workspace, wired in
// Task 7) tell this panel which familiar `sessions` actually corresponds to,
// so a familiar switch never resolves against another familiar's still-in-
// flight roster. See right-chat-session.ts's isCurrentRightChatSessionsScope.
assert.match(
  source,
  /sessionsScopeFamiliarId\?: RightChatSessionsScope;/,
  "the panel exposes an optional applied-session-scope prop, ready for Workspace to wire in Task 7",
);
assert.match(
  source,
  /import \{\s*\n\s*eligibleRightChatSessions,\s*\n\s*isCurrentRightChatSessionsScope,\s*\n\s*resolveLatestRightChatSessionId,\s*\n\s*type RightChatSessionsScope,\s*\n\s*\} from "@\/lib\/right-chat-session";/,
  "the scope check reuses the shared right-chat-session helper/type rather than inventing a parallel one",
);
assert.match(
  source,
  /const sessionsScopeCurrent =\s*\n\s*activeFamiliar === null \|\|\s*\n\s*isCurrentRightChatSessionsScope\(sessionsScopeFamiliarId, activeFamiliar\.id\);/,
  "scope currency is derived once and reused by both the resolve effect and the render-blocking gate",
);
assert.match(
  source,
  /!sessionsScopeCurrent && !hasResolvedRouter/,
  "an unconfirmed scope only blocks rendering (and ChatRouter's own mount) before this familiar has ever resolved -- exactly like the familiarsError/sessionsError transient-vs-first-load distinction",
);

// Resolution must be scoped to the active familiar + a loaded, error-free,
// scope-confirmed session list, AND to `open` for the actual imperative
// resolve itself (cave-rl980 Task 4 spec review): first-open semantics
// require resolving against whichever session is newest at the moment the
// panel actually becomes visible, never one resolved earlier while hidden.
// But every familiar-identity TRANSITION is still tracked regardless of
// `open`, readiness, errors, or scope, via trackedFamiliarIdRef, since
// ChatRouter/ChatView stay mounted underneath as a persistent controller —
// a closed A -> B -> A round trip, even one that happens entirely while a
// roster error is active throughout, must still invalidate whatever was
// resolved for the earlier A so the panel resolves fresh, against
// then-current sessions, the moment it reopens, rather than wrongly
// concluding nothing had changed (cave-rl980 Task 4 review: identity
// tracking/invalidation happens BEFORE the loading/error readiness guard,
// not merged with it). The effect additionally gates the actual resolve on
// familiars/session readiness/errors: resolving — and marking
// resolvedFamiliarRef resolved — on a render where the router isn't
// actually mounted would silently no-op the openSession/newChat call and
// then permanently skip the real resolution once the router does mount.
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{\s*\n\s*if \(!activeFamiliar\) return;/,
  "the merged effect's very first statement is the plain !activeFamiliar guard, unconditional on readiness/errors/scope, so identity tracking below it always runs",
);
assert.match(
  source,
  /if \(trackedFamiliarIdRef\.current !== activeFamiliar\.id\) \{[\s\S]*?\n\s*\}\n\n\s*if \(!familiarsLoaded \|\| familiarsError \|\| !sessionsLoaded \|\| sessionsError\) return;/,
  "familiar-identity tracking/invalidation runs BEFORE the loading/error readiness guard (cave-rl980 Task 4 review), so a transition during an active error is never missed",
);
// Applied-session-scope contract (cave-rl980 Task 4 review): `sessions` can
// still be the OUTGOING familiar's roster for a render or more after
// `activeFamiliar` itself has already changed (Workspace's session list is
// fetched scoped to a single active familiar and refetches asynchronously
// on every switch). The resolve/reconcile below must never run against it
// until the caller confirms `sessions` corresponds to THIS familiar.
assert.match(
  source,
  /if \(!familiarsLoaded \|\| familiarsError \|\| !sessionsLoaded \|\| sessionsError\) return;\s*\n\s*if \(!sessionsScopeCurrent\) return;/,
  "the resolve/reconcile is additionally gated on the applied-session-scope contract, checked immediately after readiness/errors",
);

// Every familiar-identity transition invalidates retained resolution and
// selection ownership regardless of `open` (cave-rl980 Task 4 spec review),
// so a closed A -> B -> A round trip is still detected as needing a fresh
// resolve instead of being mistaken for "still on the same, already-resolved
// A" — resolvedFamiliarRef is never touched while closed, so without this
// separate tracking ref it would still read the ORIGINAL A's id.
assert.match(
  source,
  /const trackedFamiliarIdRef = useRef<string \| null>\(null\);/,
  "a dedicated ref tracks every familiar-identity transition independent of whether a resolve has actually happened",
);
assert.match(
  source,
  /if \(trackedFamiliarIdRef\.current !== activeFamiliar\.id\) \{/,
  "a transition is detected by comparing against trackedFamiliarIdRef, not resolvedFamiliarRef, so a closed round trip back to a previously-resolved familiar is still caught",
);
assert.match(
  source,
  /if \(resolvedFamiliarRef\.current !== activeFamiliar\.id\) \{/,
  "a familiar change (or first open) is handled first and returns, before any eligibility check ever sees the outgoing familiar's stale selection",
);
assert.match(
  source,
  /\/\/ First open, or a genuine familiar change: needs a fresh resolve\.\s*\n\s*\/\/ Never touch the router or the selection while the panel is closed/,
  "the resolve is deferred, not performed, while the panel is closed",
);
assert.match(
  source,
  /if \(!open\) return;\s*\n\s*resolvedFamiliarRef\.current = activeFamiliar\.id;/,
  "the imperative resolve itself — not just its announcement — is gated on `open`: first-open semantics require the freshest session data at the moment the panel actually becomes visible",
);
assert.doesNotMatch(
  source,
  /if \(open\) \{\s*\n\s*announce\(/,
  "the announcement is no longer separately gated — the surrounding `if (!open) return;` already guarantees `open` is true by the time it's reached",
);
assert.match(
  source,
  /if \(!selectedSessionId\) return;\s*\n\s*if \(eligibleSessions\.some\(\(session\) => session\.id === selectedSessionId\)\) return;\s*\n\s*if \(!observedSessionIdsRef\.current\.has\(selectedSessionId\)\) return;/,
  "the same-familiar reconcile branch keeps its selected-id/eligibility/observed guard",
);

// A newly promoted session id (null → id, reported the instant a message
// starts a chat from a blank compose) can arrive before the `sessions`
// roster prop has been refetched to include it. The reconcile effect must
// not classify that as a deletion — it may only replace a selected id once
// that id had previously been observed present in the eligible roster.
assert.match(
  source,
  /const observedSessionIdsRef = useRef<Set<string>>\(new Set\(\)\);/,
  "the panel tracks every session id it has actually observed in the eligible roster",
);
// Recorded from an effect, not inline during render (cave-rl980 Task 4
// review): a render React abandons before commit must never leave a mark on
// reconciliation state.
assert.match(
  source,
  /useEffect\(\(\) => \{\s*\n\s*for \(const session of eligibleSessions\) observedSessionIdsRef\.current\.add\(session\.id\);\s*\n\s*\}, \[eligibleSessions\]\);/,
  "the observed-ids record is only ever updated from an effect keyed on eligibleSessions, after a render actually commits",
);
assert.match(
  source,
  /if \(!observedSessionIdsRef\.current\.has\(selectedSessionId\)\) return;/,
  "the reconcile effect only replaces a selected id once it was previously observed eligible — never a just-promoted id the roster hasn't caught up to yet",
);

// ChatRouter reports a null active session in two shapes that read
// identically from here: an ordinary "list" transition (e.g. "Back to
// sessions" after a transcript load failure — the session is still fully
// eligible) and a genuine removal (archive/delete's onBack, or a discarded
// voice pre-session's onVoiceSessionDiscarded). Only the second may retain
// or replace the prior selectedSessionId; the first must clear immediately.
// pendingRemovalRef distinguishes them, armed only by handleSessionRemoved
// (ChatView's own narrow, purpose-built removal signal — see its doc in
// chat-view.tsx — fired at the exact archive/delete/discard call sites, NOT
// inferred from the generic onSessionsChanged/onSessionsDeleted refresh
// callbacks, which also fire for refreshes unrelated to this session's
// removal). Explicit New chat actions bypass this handler entirely: they
// call setSelectedSessionId(null) directly at the moment they act.
assert.match(
  source,
  /const pendingRemovalRef = useRef\(false\);/,
  "a ref tracks whether a removal mutation was just reported, for the very next active-session report to consume",
);
assert.match(
  source,
  /const removalConfirmed = pendingRemovalRef\.current;\s*\n\s*pendingRemovalRef\.current = false;/,
  "handleActiveSessionChange reads then resets the armed removal flag exactly once per report — never leaves it to leak into a later, unrelated transition",
);
// A confirmed removal (fix 1/2, cave-rl980 Task 4 spec review) branches on
// whether the removed id was ever observed eligible: a previously observed
// id is retained until the roster itself confirms the removal (there IS a
// future transition to wait for); a NEVER-observed id (a promoted/voice
// session discarded before the roster ever caught up to it) has no such
// future transition to wait for, so onSessionRemoved's confirmation is
// trusted immediately and a replacement resolves right away instead of
// leaving the panel on a permanent ghost.
assert.match(
  source,
  /const removedId = currentSelectionRef\.current\.sessionId;\s*\n\s*if \(removalConfirmed && removedId !== null\) \{/,
  "a confirmed removal is evaluated against the CURRENT ref-read selection, not a value closed over by this function instance",
);
assert.match(
  source,
  /if \(observedSessionIdsRef\.current\.has\(removedId\)\) \{/,
  "a previously observed removed id is retained, deferring to the same-familiar reconcile branch once the roster confirms it",
);
assert.match(
  source,
  /resolveLatestRightChatSessionId\(\s*\n\s*sessions\.filter\(\(session\) => session\.id !== removedId\),\s*\n\s*activeFamiliar\.id,\s*\n\s*\);/,
  "a never-observed confirmed removal resolves a replacement immediately, explicitly excluding the removed id in case a stale sessions snapshot still lists it",
);
// The narrow removal signal (fix 1, cave-rl980 Task 4 review): arms
// pendingRemovalRef for a removal of the exact session currently selected —
// never inferred from the generic onSessionsChanged/onSessionsDeleted
// refresh callbacks, which also fire for reasons that have nothing to do
// with this session's removal (a canonical-session reconcile after a stream
// settles, a *different* thread auto-archiving on reflection, a Board
// handoff refresh, …).
//
// Reads currentSelectionRef (cave-rl980 Task 4 final review), not the
// selectedSessionId/activeFamiliar closed over by this exact function
// instance: ChatView's archive/delete/discard flows are async, and the
// specific onSessionRemoved closure a still-in-flight request retains is
// whichever one was current when THAT request began — frozen even after the
// user switches to a different thread or familiar while it is still
// in-flight. Comparing against the ref instead of the closure means the
// check always sees the CURRENT truth.
assert.match(
  source,
  /const currentSelectionRef = useRef<\{ familiarId: string \| null; sessionId: string \| null \}>\(\{\s*\n\s*familiarId: null,\s*\n\s*sessionId: null,\s*\n\s*\}\);/,
  "a ref mirrors the current selection (familiar id + session id) for handleSessionRemoved to consult instead of stale closure state",
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{\s*\n\s*currentSelectionRef\.current = \{ familiarId: activeFamiliar\?\.id \?\? null, sessionId: selectedSessionId \};\s*\n\s*\}, \[activeFamiliar, selectedSessionId\]\);/,
  "currentSelectionRef commits synchronously (useLayoutEffect, no early-return guard) so it never lags behind the actual rendered selection",
);
assert.match(
  source,
  /const handleSessionRemoved = \(removedSessionId: string\) => \{\s*\n\s*const current = currentSelectionRef\.current;\s*\n\s*if \(current\.sessionId !== removedSessionId\) return;\s*\n\s*pendingRemovalRef\.current = true;\s*\n\s*\};/,
  "handleSessionRemoved arms pendingRemovalRef for a removal of the exact CURRENT (ref-read) selected session — authoritative regardless of observed-ID membership, since ChatView only fires it for a confirmed archive/delete/discard",
);
assert.doesNotMatch(
  source,
  /const handleSessionRemoved = \(removedSessionId: string\) => \{[\s\S]{0,200}observedSessionIdsRef/,
  "handleSessionRemoved must not gate arming on observedSessionIdsRef — a session promoted and removed before the roster ever caught up to it is just as real a removal as one the roster had already shown",
);
assert.match(
  source,
  /onActiveSessionChange=\{handleActiveSessionChange\}/,
  "ChatRouter's active-session reports are routed through the retain-or-clear handler",
);
assert.doesNotMatch(
  source,
  /onActiveSessionChange=\{setSelectedSessionId\}/,
  "ChatRouter must not wire directly into setSelectedSessionId — an organic null needs the retain-or-clear decision",
);
assert.match(
  source,
  /onSessionRemoved=\{handleSessionRemoved\}/,
  "ChatRouter's narrow removal signal is routed through the arming handler",
);
assert.match(
  source,
  /onSessionsChanged=\{props\.onSessionsChanged\}/,
  "ChatRouter's onSessionsChanged is forwarded to the raw prop unchanged — RightChatPanel no longer intercepts every call to guess at removal, preserving existing behavior for every other consumer",
);
assert.match(
  source,
  /onSessionsDeleted=\{props\.onSessionsDeleted\}/,
  "ChatRouter's onSessionsDeleted is forwarded to the raw prop unchanged — RightChatPanel no longer intercepts every call to guess at removal, preserving existing behavior for every other consumer",
);
assert.doesNotMatch(
  source,
  /const handleSessionsChanged = /,
  "onSessionsChanged must no longer be wrapped to arm the removal flag — it also fires for unrelated refreshes, which would misclassify an ordinary back as a confirmed removal",
);
assert.doesNotMatch(
  source,
  /const handleSessionsDeleted = /,
  "onSessionsDeleted must no longer be wrapped to arm the removal flag — the narrow onSessionRemoved signal owns that job instead",
);

// Transient roster errors (a failed refresh, not a first load) must not tear
// down an already-mounted ChatRouter's transcript/stream/scroll state.
// hasResolvedRouter distinguishes "never resolved this familiar" (blocking
// error is safe — nothing is mounted yet) from "already resolved, error is
// transient" (keep the router mounted; surface the error inline instead).
assert.match(
  source,
  /const hasResolvedRouter = activeFamiliar !== null && resolvedFamiliarRef\.current === activeFamiliar\.id;/,
  "hasResolvedRouter tracks whether this exact familiar's router has already resolved/mounted",
);
assert.match(source, /familiarsError && !hasResolvedRouter/, "a familiars-roster error only blocks rendering before the router has resolved");
assert.match(source, /sessionsError && !hasResolvedRouter/, "a sessions-roster error only blocks rendering before the router has resolved");

// Every loading/error/chooser state must expose a discoverable Close action
// — crucial in a focus-trapped mobile modal — via one shared frame instead
// of four hand-duplicated headers.
assert.equal(
  (source.match(/<RightChatPanelFrame\b/g) ?? []).length,
  4,
  "loading, the familiars error, the no-active-familiar chooser, and the sessions error all share one Close-carrying frame",
);
assert.ok(
  (source.match(/aria-label="Close Chat panel"/g) ?? []).length >= 2,
  "Close is rendered by both the shared frame and the fully resolved header",
);

// The familiar chooser must offer only the filtered, resolved roster —
// archived/hidden familiars must never be selectable there.
assert.match(
  source,
  /\{resolvedFamiliars\.map\(\(familiar\) => \(/,
  "the no-active-familiar chooser iterates the filtered resolved roster",
);
assert.doesNotMatch(
  source,
  /\{familiars\.map\(/,
  "the chooser must not iterate the raw, unfiltered familiars prop",
);

// When the active familiar becomes null, the retained resolution, any armed
// removal flag, and the manual selection must all be cleared instead of
// quietly pointing at a stale familiar's session (or consuming a stale
// removal flag) the next time a familiar becomes active again.
assert.match(
  source,
  /if \(activeFamiliar\) return;\s*resolvedFamiliarRef\.current = null;\s*pendingRemovalRef\.current = false;\s*setSelectedSessionId\(null\);/,
  "clearing the active familiar clears the retained resolution, the armed removal flag, and the selection",
);

// Never default to familiars[0] when no familiar is active.
assert.doesNotMatch(source, /familiars\[0\]/, "the no-active-familiar chooser never silently defaults to the first familiar");

assert.match(source, /useResolvedFamiliars\(familiars\)/, "FamiliarAvatar is fed a ResolvedFamiliar via the shared resolver");
assert.match(source, /<FamiliarAvatar\b/, "the header renders the resolved avatar");
assert.match(source, /useAnnouncer\(\)/, "familiar/chat changes are announced via the shared live region");
assert.match(source, /<ErrorState\b/, "familiar and session failures render the shared ErrorState");
assert.match(source, /<EmptyState\b/, "the no-active-familiar chooser uses the shared EmptyState");
assert.match(source, /<Button\b/, "retry and chooser actions use the shared Button");

// A stale applied-session-scope must never block indefinitely once the
// caller's OWN fetch for that scope has actually failed (cave-rl980 Task 4
// final review): the loading gate's scope clause only holds while there is
// still something to wait for.
assert.match(
  source,
  /activeFamiliar !== null && !sessionsScopeCurrent && !hasResolvedRouter && !sessionsError/,
  "an unconfirmed scope stops blocking rendering the instant the target familiar's own sessions fetch has failed, falling through to the explicit sessions ErrorState instead of an indefinite spinner",
);

// Persistent, closed roots must be truthfully out of the tab order and the
// accessibility tree while staying mounted (cave-rl980 Task 4 review) — see
// RightChatPanelFrame's own doc for why a merely visually-collapsed root is
// not enough on its own.
assert.match(
  source,
  /function RightChatPanelFrame\(\{\s*open,\s*onClose,/,
  "the shared frame takes an explicit open prop",
);
assert.match(
  source,
  /<aside className="right-chat" aria-label="Chat panel" aria-hidden=\{!open\} inert=\{!open\}>/,
  "the shared frame applies truthful aria-hidden/inert to its own root",
);
assert.equal(
  (source.match(/<RightChatPanelFrame onClose=\{props\.onClose\} open=\{open\}>/g) ?? []).length,
  4,
  "every one of the four shared-frame call sites forwards the panel's own open prop",
);
assert.match(
  source,
  /aria-hidden=\{!open\}\s*\n\s*inert=\{!open\}\s*\n\s*data-session-id=\{selectedSessionId \?\? "new"\}/,
  "the fully resolved aside applies the same truthful aria-hidden/inert pairing",
);

// cave-rl980 Task 5 finding #2: `inert` alone only reaches DOM descendants,
// but a child Chat modal (ChatArtifactViewer's fullscreen view, ChatSpecCard,
// ImageCarousel's lightbox) opened from within ChatRouter's transcript
// portals to document.body directly — a DOM SIBLING of this panel, never a
// descendant — so this panel's own `inert` never reaches it. Every one of
// those dialogs calls the shared useFocusTrap, which consumes
// FocusTrapOwnerHiddenContext automatically, so wrapping ChatRouter's own
// render branch (and, defensively, every loading/error/chooser branch too)
// in the same context is what actually closes a still-open child the
// instant this panel becomes hidden — no DOM relocation hack, no new event
// bus, and no change needed to any of those components themselves.
assert.match(
  source,
  /import \{ FocusTrapOwnerHiddenContext \} from "@\/lib\/use-focus-trap";/,
  "imports the shared owner-hidden context rather than inventing a parallel mechanism",
);
assert.match(
  source,
  /<FocusTrapOwnerHiddenContext\.Provider value=\{!open\}>\{children\}<\/FocusTrapOwnerHiddenContext\.Provider>/,
  "the shared loading/error/chooser frame marks its children's owner hidden the instant it isn't open",
);
assert.match(
  source,
  /<FocusTrapOwnerHiddenContext\.Provider value=\{!open\}>\s*\n\s*\{transientErrorHeadline/,
  "the fully resolved aside — the branch that actually mounts ChatRouter — wraps its content in the same owner-hidden boundary",
);

const workspaceSource = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(workspaceSource, /const \[rightChatOpen, setRightChatOpen\] = useState\(false\)/, "Workspace receives shell visibility for first-open resolution");
assert.match(workspaceSource, /const rightChat = \([\s\S]*?<RightChatPanel/, "Workspace creates one persistent auxiliary controller");
assert.match(workspaceSource, /rightChat=\{rightChat\}/, "the controller is supplied independently of the active surface");
assert.match(workspaceSource, /onRightChatOpenChange=\{setRightChatOpen\}/, "Shell visibility reaches the controller");
assert.doesNotMatch(workspaceSource, /mode === "chat" \? rightChat/, "the auxiliary panel is not limited to the Chat destination");
assert.match(
  source,
  /<\/ChatRouter>|\/>\s*\n\s*<\/div>\s*\n\s*<\/FocusTrapOwnerHiddenContext\.Provider>/,
  "ChatRouter (and any child dialog it renders) sits INSIDE the owner-hidden boundary, not beside it",
);

// cave-rl980 Task 5: MobileDrawer grows a dedicated right-chat modal slot so
// the global right Chat panel gets an accessible mobile/tablet presentation
// instead of a fourth ad hoc overlay. Pinned here (not a render test): this
// suite's Node environment has no DOM/jsdom, matching the convention already
// used for this hook's other consumers (see use-focus-trap.test.ts,
// modal.test.ts) — behavior is proven by pinning the implementing source,
// not by executing it against a real document.
const drawerSource = await readFile(new URL("./mobile-drawer.tsx", import.meta.url), "utf8");

assert.match(
  drawerSource,
  /export type MobileDrawerSlot = "nav" \| "list" \| "right-chat" \| null;/,
  "the right Chat panel gets a dedicated drawer slot alongside nav/list",
);
assert.match(
  drawerSource,
  /rightChat\?: ReactNode;/,
  "MobileDrawer accepts the right Chat panel's modal content",
);
assert.match(
  drawerSource,
  /useFocusTrap\(open === "right-chat", rightChatRef, \{ onEscape: onClose \}\)/,
  "the right Chat drawer traps and returns focus via the shared hook, consistent with Modal's own usage",
);
assert.match(
  drawerSource,
  /role="dialog"[\s\S]{0,80}aria-modal="true"[\s\S]{0,80}aria-label="Chat panel"/,
  "the right Chat drawer is a labelled modal dialog",
);
assert.match(
  drawerSource,
  /id="shell-right-chat-drawer"/,
  "the right Chat drawer exposes a stable id for Shell/CSS to target",
);
assert.match(
  drawerSource,
  /className="mobile-right-chat-drawer"/,
  "the right Chat drawer exposes a stable class hook for Task 8 styling",
);
assert.match(
  drawerSource,
  /aria-hidden=\{open !== "right-chat"\}/,
  "closing marks the right Chat drawer aria-hidden rather than unmounting it",
);
assert.match(
  drawerSource,
  /hidden=\{open !== "right-chat"\}/,
  "closing hides the right Chat drawer rather than unmounting it",
);
assert.match(
  drawerSource,
  /inert=\{open !== "right-chat"\}/,
  "closing makes the right Chat drawer inert rather than unmounting it",
);
assert.match(
  drawerSource,
  /tabIndex=\{-1\}/,
  "the right Chat drawer is a reachable focus-trap fallback container per useFocusTrap's contract",
);

// Retained mount: the drawer's presence is gated on the rightChat NODE only,
// never on `open` — so React never unmounts/remounts the subtree (and the
// auxiliary ChatRouter it wraps) across opens/closes, only its hidden/inert
// state changes.
assert.match(
  drawerSource,
  /\{rightChat \? \(/,
  "the right Chat drawer's presence is gated on the rightChat node only, so it stays mounted across opens/closes",
);
assert.doesNotMatch(
  drawerSource,
  /\{open === "right-chat" && rightChat/,
  "the right Chat drawer must not be conditionally MOUNTED on open — only hidden/inert — or the retained-router contract breaks",
);
assert.match(
  drawerSource,
  /if \(!open && !rightChat\) return null;/,
  "the component itself stays mounted (portal included) whenever the rightChat node exists, even while every drawer is closed",
);

// Backdrop renders only while a drawer (nav, list, OR right-chat) is open —
// never for a merely-retained, closed right-chat modal. It's a real <button>
// (cave-rl980 Task 5 spec finding), not a role="presentation" div, so it's
// reachable from the keyboard too.
assert.match(
  drawerSource,
  /\{open \? \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*className="mobile-drawer-backdrop"/,
  "the backdrop renders only while any drawer is open, as a real <button>",
);

// Escape ownership: the legacy standalone listener must step aside for the
// right Chat drawer, which owns Escape entirely through useFocusTrap's
// onEscape — otherwise Escape would fire onClose twice for that slot.
assert.match(
  drawerSource,
  /const ownsEscape = open !== "right-chat";/,
  "the legacy Escape listener is scoped away from the right Chat drawer",
);
assert.match(
  drawerSource,
  /if \(ownsEscape\) window\.addEventListener\("keydown", onKey\);/,
  "only nav/list register the legacy Escape listener — the right Chat drawer's Escape is owned solely by useFocusTrap",
);
assert.match(
  drawerSource,
  /if \(ownsEscape\) window\.removeEventListener\("keydown", onKey\);/,
  "the legacy Escape listener teardown mirrors its scoped registration",
);

// Body/root scroll + overscroll lock must still apply for EVERY open drawer
// (nav, list, and right-chat alike) — the lock effect's gate stays the plain
// `if (!open) return;`, never narrowed to exclude right-chat.
assert.match(
  drawerSource,
  /document\.body\.style\.overflow = "hidden"/,
  "every open drawer (nav/list/right-chat) keeps body scroll locked",
);
assert.match(
  drawerSource,
  /document\.documentElement\.style\.overflow = "hidden"/,
  "every open drawer (nav/list/right-chat) keeps root scroll locked",
);
assert.doesNotMatch(
  drawerSource,
  /if \(open === "right-chat"\) return;\s*\n\s*const ownsEscape/,
  "the scroll-lock effect must never early-return before locking for the right Chat drawer",
);

// Background inert: while the right Chat modal is open, the shell chrome
// behind it must become inert — targeting `.shell-frame` specifically
// (Shell's own root, see shell.tsx), never `document.body`, since the
// backdrop/modal portal mounts to document.body itself and inerting that
// would swallow the very modal we're trying to keep interactive.
assert.match(
  drawerSource,
  /const shell = document\.querySelector<HTMLElement>\("\.shell-frame"\);/,
  "the background-inert effect targets .shell-frame, which sits outside the portal's DOM subtree",
);
assert.match(
  drawerSource,
  /const prevInert = shell\.inert;/,
  "the effect captures .shell-frame's prior inert state before overriding it",
);
assert.match(
  drawerSource,
  /shell\.inert = true;/,
  "the right Chat modal makes the shell background inert while open",
);
assert.match(
  drawerSource,
  /shell\.inert = prevInert;/,
  "closing restores .shell-frame's actual prior inert state rather than hard-coding false",
);
assert.doesNotMatch(
  drawerSource,
  /document\.body\.inert/,
  "the inert effect must never target document.body — that is the portal's own mount point",
);

// cave-rl980 Task 5 modal/focus findings: nav/list drawers previously had no
// focus management at all beyond the legacy standalone Escape listener above
// — they now reuse the SAME shared useFocusTrap hook for capture-on-open /
// restore-on-close / Tab containment, without adopting Escape ownership
// (still the legacy listener's job, unchanged above) or modal semantics
// (no role="dialog"/aria-modal on nav/list — only right-chat is a transient
// dialog; nav/list are persistent shell landmarks that merely slide over
// content at mobile widths).
assert.match(
  drawerSource,
  /navContainerRef\.current = document\.querySelector<HTMLElement>\("\.shell-nav-panel"\);/,
  "nav's focus-trap container is resolved the same cross-boundary way .shell-frame is",
);
assert.match(
  drawerSource,
  /listContainerRef\.current = document\.querySelector<HTMLElement>\("\.shell-list-panel"\);/,
  "list's focus-trap container is resolved the same cross-boundary way .shell-frame is",
);
assert.match(
  drawerSource,
  /useFocusTrap\(open === "nav", navContainerRef\);/,
  "the nav drawer captures/restores focus and contains Tab via the shared hook",
);
assert.match(
  drawerSource,
  /useFocusTrap\(open === "list", listContainerRef\);/,
  "the list drawer captures/restores focus and contains Tab via the shared hook",
);
assert.doesNotMatch(
  drawerSource,
  /useFocusTrap\(open === "nav", navContainerRef, \{ onEscape/,
  "nav must not adopt Escape ownership through the trap — Escape stays the legacy listener's job",
);
assert.doesNotMatch(
  drawerSource,
  /useFocusTrap\(open === "list", listContainerRef, \{ onEscape/,
  "list must not adopt Escape ownership through the trap — Escape stays the legacy listener's job",
);

console.log("right-chat-panel.test.ts OK");
