// Wiring pins for voice-started new chats (spec:
// docs/superpowers/specs/2026-07-18-voice-new-chat-design.md).
// Behavior lives in tested libs (start-voice-chat, dictation-controller,
// voice-chat-create); these pins keep the React/threading wiring intact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const pendingChatAction = read("../lib/pending-chat-action.ts");
const chatSurface = read("./chat-surface.tsx");
const chatRouter = read("./chat-router.tsx");
const chatView = read("./chat-view.tsx");
const startVoiceChat = read("../lib/voice/start-voice-chat.ts");

test("pending-chat-action: open kind carries autoVoice", () => {
  // Bounded so the match can't cross into a later union member if autoVoice
  // ever moved off the "open" variant — a lazy [\s\S]*? would false-pass.
  assert.match(pendingChatAction, /kind: "open";(?:(?!kind:)[\s\S])*?autoVoice\?: boolean/);
});

test("chat-surface: open handler forwards autoVoice to the router", () => {
  assert.match(chatSurface, /openSession\(pendingChatAction\.sessionId, findQuery, autoVoice\)/);
});

test("chat-router: openSession accepts autoVoice and arms the voice nonce for its session", () => {
  assert.match(chatRouter, /openSession: \(sessionId: string, findQuery\?: string, autoVoice\?: boolean\)/);
  // Unconditional set: a non-voice open must explicitly clear stale intent,
  // not just skip arming it.
  assert.match(chatRouter, /setPendingVoice\(autoVoice \? \{ nonce: Date\.now\(\), sessionId \} : null\)/);
  assert.match(chatRouter, /openVoiceNonce=\{pendingVoice\?\.nonce\}/);
  // The nonce alone doesn't identify which session it was armed for — the
  // consuming effect also needs the target session id, so a pre-session mint
  // that resolves after the user switched sessions can't misfire there.
  assert.match(chatRouter, /openVoiceSessionId=\{pendingVoice\?\.sessionId\}/);
});

test("chat-router: onVoiceSessionCreated promotes the session and arms the nonce for it", () => {
  assert.match(chatRouter, /onVoiceSessionCreated=\{\(sid\) => \{/);
  assert.match(
    chatRouter,
    /onVoiceSessionCreated=\{\(sid\) => \{[\s\S]*?prev\.sessionId === null[\s\S]*?setPendingVoice\(\{ nonce: Date\.now\(\), sessionId: sid \}\)/,
  );
});

test("chat-router: pendingVoice is scoped to its session and clears when the view leaves it", () => {
  assert.match(
    chatRouter,
    /const \[pendingVoice, setPendingVoice\] = useState<\{ nonce: number; sessionId: string \} \| null>\(null\)/,
  );
  // The clearing effect: any view whose active session isn't the one the
  // nonce was armed for drops the intent, so it can't survive navigation to
  // an unrelated session (list, resume, split-promote, plain re-open, ...).
  assert.match(
    chatRouter,
    /const active = view\.kind === "chat" \? view\.sessionId : null;[\s\S]*?if \(active !== pendingVoice\.sessionId\) setPendingVoice\(null\);/,
  );
});

test("chat-view: voice nonce effect opens the overlay for the routed session", () => {
  assert.match(chatView, /openVoiceNonce\?: number;/);
  assert.match(chatView, /const openVoiceNonceRef = useRef\(0\)/);
  // The ref is armed with the SESSION ID the call was opened for (not a bare
  // boolean) — onClose later discards exactly this session, never whatever
  // sessionId happens to be current when the user hangs up.
  assert.match(
    chatView,
    /openVoiceNonceRef\.current = openVoiceNonce;[\s\S]*?voiceAutoCreatedRef\.current = sessionId;[\s\S]*?setVoiceCallOpen\(true\)/,
  );
});

test("chat-view: voice nonce effect checks the target session before consuming the nonce", () => {
  // Guard order matters: consuming the nonce (marking it fired) before the
  // session checks would permanently lose the request across the one-render
  // gap while session promotion lands. The sessionId !== openVoiceSessionId
  // half of the guard closes a race: a pre-session mint that resolves after
  // the user has switched this view to a different session must not
  // auto-open the call overlay (and its discard-on-close path) there.
  assert.match(chatView, /openVoiceSessionId\?: string;/);
  assert.match(
    chatView,
    /if \(!sessionId \|\| sessionId !== openVoiceSessionId\) return;\s*openVoiceNonceRef\.current = openVoiceNonce/,
  );
  assert.match(chatView, /\}, \[openVoiceNonce, sessionId, openVoiceSessionId\]\);/);
});

const workspace = read("./workspace.tsx");
const homeComposer = read("./home-composer.tsx");
// The plus-menu is a thin wrapper now — the row markup (phone/mic labels)
// lives in the shared cascade menu.
const plusMenu = read("./composer-add-menu.tsx");

test("workspace: startVoiceChat creates the session then routes with autoVoice", () => {
  assert.match(
    workspace,
    /startVoiceConversation\(familiarId, projectRoot\)[\s\S]*?kind: "open", sessionId: result\.sessionId, familiarId, autoVoice: true/,
  );
  assert.match(workspace, /onStartVoiceCall=\{/);
  // The mint is awaited before navigating; the prop must return that promise
  // (not void-swallow it) so HomeComposer's in-flight guard can await it too.
  assert.match(workspace, /onStartVoiceCall=\{\(fid, projectRoot\) => startVoiceChat\(fid, projectRoot\)\}/);
  assert.doesNotMatch(workspace, /onStartVoiceCall=\{\(fid, projectRoot\) => \{ void startVoiceChat/);
});

test("workspace: startVoiceChat bails on stale navigation instead of yanking the user back to chat", () => {
  // Bounded to startVoiceChat's own body, and ordered ok-check -> staleness
  // bail -> navigation, so this can't false-pass against one of the unrelated
  // modeRef.current === "chat" checks elsewhere in the file.
  assert.match(
    workspace,
    /const startVoiceChat = useCallback\(async \(familiarId: string, projectRoot: string \| null\) => \{[\s\S]*?if \(!result\.ok\) \{[\s\S]*?return;\s*\n\s*\}[\s\S]*?if \(modeRef\.current !== "home"\) return;[\s\S]*?setActiveId\(familiarId\)/,
  );
});

test("workspace: voice chat mint errors are translated to human toast copy", () => {
  assert.match(
    startVoiceChat,
    /export function voiceChatStartErrorMessage\(code: string\): string \{[\s\S]*?"network"[\s\S]*?"familiar_not_found"[\s\S]*?\$\{code\}/,
  );
  assert.match(workspace, /import \{ startVoiceConversation, voiceChatStartErrorMessage \} from "@\/lib\/voice\/start-voice-chat"/);
  assert.match(workspace, /pushToast\(voiceChatStartErrorMessage\(result\.error\)\)/);
});

test("home-composer: call item starts a voice chat, summoning when no familiar", () => {
  // The call affordance rides the composer "+" menu (chat revamp 1d) — the
  // phone icon and "Voice call" accessible name live in the shared menu.
  assert.match(plusMenu, /icon="ph:phone"/);
  assert.match(plusMenu, /ariaLabel="Voice call"/);
  assert.match(
    homeComposer,
    /if \(voiceCallPending\) return;[\s\S]*?if \(!selectedFamiliarId\) \{[\s\S]*?requestSummonFamiliar\(\);[\s\S]*?\}/,
  );
});

test("home-composer: voice call item gates itself on an in-flight mint and always resets", () => {
  assert.match(homeComposer, /const \[voiceCallPending, setVoiceCallPending\] = useState\(false\)/);
  assert.match(homeComposer, /disabled: sending \|\| voiceCallPending/);
  // The mint must be gated start-to-finish: set pending before the call,
  // reset it in .finally so a rejected/failed mint can't leave the item
  // permanently disabled.
  assert.match(
    homeComposer,
    /setVoiceCallPending\(true\);[\s\S]*?Promise\.resolve\([\s\S]{0,120}?onStartVoiceCall\(selectedFamiliarId, selectedProject\?\.root \?\? null\),?[\s\S]{0,40}?\)\.finally\(\(\) => setVoiceCallPending\(false\)/,
  );
  // The prop type must allow returning a promise, or callers couldn't chain
  // .finally onto it to reset the pending flag.
  assert.match(
    homeComposer,
    /onStartVoiceCall\?: \(familiarId: string, projectRoot: string \| null\) => void \| Promise<void>/,
  );
});

test("chat-view: direct voice call button works pre-session by creating the conversation first", () => {
  assert.match(
    chatView,
    /<button[\s\S]*?className="cave-composer-footer-action focus-ring"[\s\S]*?onClick=\{\(\) => void openVoiceCall\(\)\}[\s\S]*?disabled=\{voiceCallPending \|\| \(busy && !sessionId\)\}[\s\S]*?title="Voice call"[\s\S]*?aria-label="Voice call"[\s\S]*?<Icon name="ph:phone" width=\{15\} aria-hidden \/>[\s\S]*?<\/button>\s*<ComposerActionsMenu/,
  );
  assert.doesNotMatch(chatView, /\{\s*sessionId\s*&&\s*<button[\s\S]{0,280}aria-label="Voice call"/);
  assert.doesNotMatch(chatView, /\{\s*sessionId\s*\?\s*<button[\s\S]{0,280}aria-label="Voice call"/);
  // Ordered end to end: mid-session fast path -> in-flight pending bail ->
  // the mint call itself -> the familiar-staleness bail -> the success
  // promote. A rapid re-click or a familiar switch mid-mint must each be
  // handled before the session is ever promoted onto the view.
  assert.match(
    chatView,
    /const openVoiceCall = useCallback\(async \(\) => \{[\s\S]*?if \(sessionId\) \{[\s\S]*?setVoiceCallOpen\(true\);[\s\S]*?if \(voiceCallPending\) return;[\s\S]*?setVoiceCallPending\(true\);[\s\S]*?startVoiceConversation\(requestedFamiliarId, projectRoot \?\? null\)[\s\S]*?if \(familiarIdRef\.current !== requestedFamiliarId\) return;[\s\S]*?onVoiceSessionCreated\?\.\(result\.sessionId\)/,
  );
});

test("chat-view: voice call button disables itself while a mint is in flight, and pre-session while busy", () => {
  // Without this, N rapid clicks before the first mint resolves fire N
  // startVoiceConversation calls: N-1 sessions are orphaned, and if two
  // resolutions land in the same render batch the last one wins, which can
  // promote a session the nonce effect never consumes (overlay never opens).
  assert.match(chatView, /const \[voiceCallPending, setVoiceCallPending\] = useState\(false\)/);
  // Also disabled pre-session while a first send is streaming (busy, no
  // sessionId yet) — a click there would mint an unrelated second session
  // and the null-guarded promotion effect would swap the view onto it
  // mid-stream. Mid-session (sessionId set) stays available while busy.
  assert.match(
    chatView,
    /onClick=\{\(\) => void openVoiceCall\(\)\}[\s\S]*?disabled=\{voiceCallPending \|\| \(busy && !sessionId\)\}[\s\S]*?aria-label="Voice call"/,
  );
});

test("chat-view: openVoiceCall always clears the pending flag, even on failure or an early bail", () => {
  assert.match(
    chatView,
    /if \(voiceCallPending\) return;\s*\n\s*setVoiceCallPending\(true\);\s*\n\s*try \{[\s\S]*?\} finally \{\s*\n\s*setVoiceCallPending\(false\);\s*\n\s*\}/,
  );
});

test("chat-view: openVoiceCall bails before promoting a mint onto a switched familiar", () => {
  // requestedFamiliarId is captured at click time (before the await); if the
  // familiar the view is showing has moved on by the time the mint resolves,
  // promoting would silently swap the NEW compose view onto the OLD
  // familiar's session. The bail must land before onVoiceSessionCreated...
  assert.match(
    chatView,
    /const requestedFamiliarId = familiar\.id;[\s\S]*?if \(familiarIdRef\.current !== requestedFamiliarId\) return;[\s\S]*?onVoiceSessionCreated\?\.\(/,
  );
  // ...and before the failure announce too — a flow the user already left
  // shouldn't surface an error for it.
  assert.match(
    chatView,
    /if \(familiarIdRef\.current !== requestedFamiliarId\) return;[\s\S]*?announce\(voiceChatStartErrorMessage\(result\.error\), "assertive"\)/,
  );
  // The ref backing the check must track the live familiar prop, not a
  // snapshot from mount.
  assert.match(
    chatView,
    /const familiarIdRef = useRef\(familiar\.id\);\s*\n\s*useEffect\(\(\) => \{\s*\n\s*familiarIdRef\.current = familiar\.id;\s*\n\s*\}, \[familiar\.id\]\);/,
  );
});

test("chat-view: voice mint failure announce is assertive, not the default polite level", () => {
  assert.match(chatView, /announce\(voiceChatStartErrorMessage\(result\.error\), "assertive"\)/);
});

test("chat-view: closing an auto-created call discards exactly the session it was created for, not whatever is current", () => {
  // Task 6/8 pin, updated for Finding 3: the ref stores the target session
  // id (not a bare boolean, see the nonce-effect test above) so a ⌘K switch
  // behind the overlay can't make onClose discard the WRONG (currently
  // active) session while leaking the one actually auto-created for this
  // call. Captured and cleared up front so the async discard always targets
  // that snapshot, never a live re-read of the ref or the sessionId prop.
  assert.match(
    chatView,
    /const target = voiceAutoCreatedRef\.current;\s*\n\s*voiceAutoCreatedRef\.current = null;\s*\n\s*if \(target\) \{\s*\n\s*void discardVoiceSessionIfEmpty\(target\)\.then\(\(deleted\) => \{\s*\n\s*if \(deleted\) \{\s*\n\s*onSessionsChanged\?\.\(\);/,
  );
  assert.match(chatView, /const voiceAutoCreatedRef = useRef<string \| null>\(null\)/);
  // Finding 1: the server-side ?ifEmpty=1 check is authoritative — no more
  // client GET-then-DELETE. That gap was the actual race: a client-read
  // "empty" could go stale by the time the DELETE landed, seconds after
  // chat/send had already recreated the file with the real exchange, and
  // the old DELETE sacrificed unconditionally, permanently hiding it.
  assert.match(startVoiceChat, /\/api\/chat\/conversation\/\$\{encoded\}\?ifEmpty=1/);
  assert.match(startVoiceChat, /method: "DELETE"/);
  // Finding 2: the view is only yanked back to compose when the discarded
  // session is still the active one — if the user already switched away,
  // the discard happens silently in the background with no view reset.
  assert.match(
    chatView,
    /if \(deleted\) \{[\s\S]*?onSessionsChanged\?\.\(\);[\s\S]*?if \(target === sessionId\) onVoiceSessionDiscarded\?\.\(\);/,
  );
  // Finding 4: the call item can't fork a streaming first send by
  // minting a second, unrelated session underneath it (pre-session only —
  // mid-session stays available while busy).
  assert.match(
    chatView,
    /onClick=\{\(\) => void openVoiceCall\(\)\}[\s\S]*?disabled=\{voiceCallPending \|\| \(busy && !sessionId\)\}[\s\S]*?aria-label="Voice call"/,
  );
  // Router side: the callback resets to a fresh compose state for the same
  // familiar/project, mirroring the onVoiceSessionCreated promotion shape
  // but back to sessionId: null.
  assert.match(
    chatRouter,
    /onVoiceSessionDiscarded=\{\(\) => \{[\s\S]*?prev\.kind === "chat"[\s\S]*?sessionId: null, projectRoot: prev\.projectRoot, familiarId: prev\.familiarId/,
  );
});

test("both composers mount dictation with fill-and-review append", () => {
  for (const [name, src] of [["chat-view", chatView], ["home-composer", homeComposer]] as const) {
    assert.match(src, /useDictation\(/, `${name} mounts useDictation`);
    assert.match(src, /dictation\.available\s*\n?\s*\?/, `${name} hides the mic when no ears exist`);
    assert.match(src, /hc-dictation-caption/, `${name} renders the live partial caption`);
    // The streaming partial would re-announce on every update if it carried
    // aria-live — SR hostile. The mic's aria-pressed already announces toggle
    // state (repo convention: voice-call-overlay.tsx live-announces only
    // coarse state, not the fast-changing text underneath it).
    assert.doesNotMatch(src, /hc-dictation-caption" aria-live/, `${name} caption has no aria-live`);
  }
  // The mic item lives in the shared "+" menu (chat revamp 1d): its label swap
  // and aria-pressed state survive the relocation.
  assert.match(plusMenu, /ariaLabel=\{legacy\.dictation\.listening \? "Stop dictation" : "Dictate your message"\}/, "plus-menu mic label");
  assert.match(plusMenu, /ariaPressed=\{legacy\.dictation\.listening\}/, "plus-menu mic keeps aria-pressed");
  // A live toggle must always accept "stop": a disabled mic mid-listen would
  // leave the user with a hot mic they can't turn off for the whole agent
  // turn (chat) or send window (home). Only START stays gated on busy/sending.
  assert.match(chatView, /disabled: busy && !dictation\.listening/, "chat-view mic allows stop while busy");
  assert.match(homeComposer, /disabled: sending && !dictation\.listening/, "home-composer mic allows stop while sending");

  // A live call and composer dictation can't share the mic engine: opening
  // the call overlay — direct fast path, the auto-create nonce path, or any
  // future setVoiceCallOpen site — must stop dictation. Home needs no
  // equivalent: its phone button navigates away, and unmounting the composer
  // closes dictation.
  assert.match(
    chatView,
    /useEffect\(\(\) => \{\s*\n\s*if \(voiceCallOpen && dictation\.listening\) dictation\.toggle\(\);\s*\n\s*\}, \[voiceCallOpen, dictation\.listening, dictation\.toggle\]\);/,
  );
});
