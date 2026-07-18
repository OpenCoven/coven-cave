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

test("chat-view: voice nonce effect checks sessionId before consuming the nonce", () => {
  // Guard order matters: consuming the nonce (marking it fired) before the
  // sessionId check would permanently lose the request across the one-render
  // gap while session promotion lands.
  assert.match(chatView, /if \(!sessionId\) return;\s*openVoiceNonceRef\.current = openVoiceNonce/);
});

const workspace = read("./workspace.tsx");
const homeComposer = read("./home-composer.tsx");

test("workspace: startVoiceChat creates the session then routes with autoVoice", () => {
  assert.match(
    workspace,
    /startVoiceConversation\(familiarId, projectRoot\)[\s\S]*?kind: "open", sessionId: result\.sessionId, familiarId, autoVoice: true/,
  );
  assert.match(workspace, /onStartVoiceCall=\{/);
});

test("home-composer: call button starts a voice chat, summoning when no familiar", () => {
  assert.match(homeComposer, /aria-label="Start a voice call in a new chat"/);
  assert.match(homeComposer, /"ph:phone"/);
  assert.match(
    homeComposer,
    /if \(!selectedFamiliarId\) \{[\s\S]*?requestSummonFamiliar\(\);[\s\S]*?\}\s*\n\s*onStartVoiceCall\(selectedFamiliarId, selectedProject\?\.root \?\? null\)/,
  );
});
