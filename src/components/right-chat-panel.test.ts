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
assert.match(source, /aria-label="Switch Chat panel thread"/, "the compact header exposes a labelled thread switcher");
assert.match(source, /aria-label="New Chat panel chat"/, "the compact header exposes New chat");
assert.match(source, /aria-label="Close Chat panel"/, "the compact header exposes Close");
assert.doesNotMatch(
  source,
  /RightPanelKind|companionTabs|agent\?: ReactNode/,
  "the dedicated wrapper does not restore generic companion concepts",
);

// Resolution must be scoped to `open` + the active familiar + a loaded,
// error-free session list. The first-resolution effect additionally gates on
// familiars readiness/errors (cave-rl980 Task 4 review): resolving — and
// marking resolvedFamiliarRef resolved — on a render where the router isn't
// actually mounted would silently no-op the openSession/newChat call and
// then permanently skip the real resolution once the router does mount.
assert.match(
  source,
  /if \(!open \|\| !activeFamiliar \|\| !familiarsLoaded \|\| familiarsError \|\| !sessionsLoaded \|\| sessionsError\) return;/,
  "the first-resolution effect gates on both familiar and session readiness/errors so a null router can never be marked resolved",
);
assert.match(
  source,
  /if \(!open \|\| !activeFamiliar \|\| !sessionsLoaded \|\| sessionsError \|\| !selectedSessionId\) return;/,
  "the ineligible-selection reconcile effect keeps its open/familiar/loaded-sessions/no-error/selected-id guard",
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
// the prior selectedSessionId so the reconcile effect above can resolve it
// once the roster confirms removal; the first must clear immediately.
// pendingRemovalRef (armed by handleSessionsChanged/handleSessionsDeleted,
// the two calls every removal path makes immediately before its null)
// distinguishes them, gated additionally on prior observation so a
// discarded, never-observed promotion (which also reports through
// onSessionsChanged) clears instead of leaving a permanent ghost. Explicit
// New chat actions bypass this handler entirely: they call
// setSelectedSessionId(null) directly at the moment they act.
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
assert.match(
  source,
  /removalConfirmed && prev !== null && observedSessionIdsRef\.current\.has\(prev\) \? prev : null/,
  "an organic null only retains the prior selection when a removal was just confirmed AND that id was previously observed eligible — every other null (ordinary back, or a never-observed discarded promotion) clears immediately",
);
assert.match(
  source,
  /const handleSessionsChanged = \(\) => \{\s*\n\s*pendingRemovalRef\.current = true;\s*\n\s*props\.onSessionsChanged\(\);\s*\n\s*\};/,
  "onSessionsChanged is wrapped to arm the removal flag before forwarding, never forked",
);
assert.match(
  source,
  /const handleSessionsDeleted = \(sessionIds: readonly string\[\]\) => \{\s*\n\s*pendingRemovalRef\.current = true;\s*\n\s*props\.onSessionsDeleted\(sessionIds\);\s*\n\s*\};/,
  "onSessionsDeleted is wrapped to arm the removal flag before forwarding, never forked",
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
  /onSessionsChanged=\{handleSessionsChanged\}/,
  "ChatRouter's onSessionsChanged is routed through the arming wrapper, not the raw prop",
);
assert.match(
  source,
  /onSessionsDeleted=\{handleSessionsDeleted\}/,
  "ChatRouter's onSessionsDeleted is routed through the arming wrapper, not the raw prop",
);
assert.doesNotMatch(
  source,
  /onSessionsChanged=\{props\.onSessionsChanged\}/,
  "ChatRouter must not wire directly into the raw onSessionsChanged prop — the wrapper needs to observe every call",
);
assert.doesNotMatch(
  source,
  /onSessionsDeleted=\{props\.onSessionsDeleted\}/,
  "ChatRouter must not wire directly into the raw onSessionsDeleted prop — the wrapper needs to observe every call",
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

console.log("right-chat-panel.test.ts OK");
