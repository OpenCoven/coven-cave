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
  assert.match(
    chatView,
    /openVoiceNonceRef\.current = openVoiceNonce;[\s\S]*?voiceAutoCreatedRef\.current = true;[\s\S]*?setVoiceCallOpen\(true\)/,
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
    workspace,
    /function voiceChatStartErrorMessage\(code: string\): string \{[\s\S]*?"network"[\s\S]*?"familiar_not_found"[\s\S]*?\$\{code\}/,
  );
  assert.match(workspace, /pushToast\(voiceChatStartErrorMessage\(result\.error\)\)/);
});

test("home-composer: call button starts a voice chat, summoning when no familiar", () => {
  assert.match(homeComposer, /aria-label="Start a voice call in a new chat"/);
  assert.match(homeComposer, /"ph:phone"/);
  assert.match(
    homeComposer,
    /if \(voiceCallPending\) return;[\s\S]*?if \(!selectedFamiliarId\) \{[\s\S]*?requestSummonFamiliar\(\);[\s\S]*?\}/,
  );
});

test("home-composer: voice call button gates itself on an in-flight mint and always resets", () => {
  assert.match(homeComposer, /const \[voiceCallPending, setVoiceCallPending\] = useState\(false\)/);
  assert.match(homeComposer, /disabled=\{sending \|\| voiceCallPending\}/);
  // The mint must be gated start-to-finish: set pending before the call,
  // reset it in .finally so a rejected/failed mint can't leave the button
  // permanently disabled.
  assert.match(
    homeComposer,
    /setVoiceCallPending\(true\);[\s\S]*?Promise\.resolve\(onStartVoiceCall\(selectedFamiliarId, selectedProject\?\.root \?\? null\)\)\.finally\(\(\) =>\s*setVoiceCallPending\(false\)/,
  );
  // The prop type must allow returning a promise, or callers couldn't chain
  // .finally onto it to reset the pending flag.
  assert.match(
    homeComposer,
    /onStartVoiceCall\?: \(familiarId: string, projectRoot: string \| null\) => void \| Promise<void>/,
  );
});

test("chat-view: call button works pre-session by creating the conversation first", () => {
  assert.match(chatView, /aria-label="Voice call"/);
  // Ordered end to end: mid-session fast path -> in-flight pending bail ->
  // the mint call itself -> the familiar-staleness bail -> the success
  // promote. A rapid re-click or a familiar switch mid-mint must each be
  // handled before the session is ever promoted onto the view.
  assert.match(
    chatView,
    /const openVoiceCall = useCallback\(async \(\) => \{[\s\S]*?if \(sessionId\) \{[\s\S]*?setVoiceCallOpen\(true\);[\s\S]*?if \(voiceCallPending\) return;[\s\S]*?setVoiceCallPending\(true\);[\s\S]*?startVoiceConversation\(requestedFamiliarId, projectRoot \?\? null\)[\s\S]*?if \(familiarIdRef\.current !== requestedFamiliarId\) return;[\s\S]*?onVoiceSessionCreated\?\.\(result\.sessionId\)/,
  );
});

test("chat-view: voice call button disables itself while a mint is in flight", () => {
  // Without this, N rapid clicks before the first mint resolves fire N
  // startVoiceConversation calls: N-1 sessions are orphaned, and if two
  // resolutions land in the same render batch the last one wins, which can
  // promote a session the nonce effect never consumes (overlay never opens).
  assert.match(chatView, /const \[voiceCallPending, setVoiceCallPending\] = useState\(false\)/);
  assert.match(chatView, /aria-label="Voice call"[\s\S]{0,200}disabled=\{voiceCallPending\}/);
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

test("chat-view: closing an auto-created call discards the session when empty", () => {
  assert.match(
    chatView,
    /voiceAutoCreatedRef\.current = false;[\s\S]*?discardVoiceSessionIfEmpty\(sessionId\)[\s\S]*?onSessionsChanged\?\.\(\)/,
  );
});
