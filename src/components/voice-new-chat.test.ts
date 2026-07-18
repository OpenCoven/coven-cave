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
  assert.match(pendingChatAction, /kind: "open";[\s\S]*?autoVoice\?: boolean/);
});

test("chat-surface: open handler forwards autoVoice to the router", () => {
  assert.match(chatSurface, /openSession\(pendingChatAction\.sessionId, findQuery, autoVoice\)/);
});

test("chat-router: openSession accepts autoVoice and arms the voice nonce", () => {
  assert.match(chatRouter, /openSession: \(sessionId: string, findQuery\?: string, autoVoice\?: boolean\)/);
  assert.match(chatRouter, /if \(autoVoice\) setPendingVoice\(\{ nonce: Date\.now\(\) \}\)/);
  assert.match(chatRouter, /openVoiceNonce=\{pendingVoice\?\.nonce\}/);
});

test("chat-router: onVoiceSessionCreated promotes the session and arms the nonce", () => {
  assert.match(chatRouter, /onVoiceSessionCreated=\{\(sid\) => \{/);
  assert.match(
    chatRouter,
    /onVoiceSessionCreated=\{\(sid\) => \{[\s\S]*?prev\.sessionId === null[\s\S]*?setPendingVoice\(\{ nonce: Date\.now\(\) \}\)/,
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
