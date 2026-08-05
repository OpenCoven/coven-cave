// @ts-nocheck
/**
 * Behavior/source pins for the compose-instance nonce that fixes the
 * null→null navigation race (Task 1 final gap).
 *
 * Race: user opens compose A → then compose B before A sends.  Both have
 * sessionId=null, so ChatView's sessionId-diff guard never fires.  A's late
 * session event would promote into B.
 *
 * Fix: ChatRouter owns a monotonically increasing `composeInstance` nonce.
 * Every explicit new-blank-compose transition increments it; session promotion
 * (null→sessionId) does not.  ChatView clears displayedCreationRunIdRef when
 * the nonce changes, revoking A's ownership for B.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, useLayoutEffect, useRef, useState } from "react";
import { act, create } from "react-test-renderer";

const routerSource = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── 1. ChatRouter owns the nonce ─────────────────────────────────────────────

assert.match(
  routerSource,
  /const \[composeInstance, setComposeInstance\] = useState\(0\)/,
  "ChatRouter must declare a composeInstance nonce as state (starts at 0)",
);

// ── 2. Imperative newChat increments the nonce ───────────────────────────────

const newChatImperative =
  routerSource.match(/newChat: \([\s\S]*?\) => \{[\s\S]*?\},\s*openSession/)?.[0] ?? "";

assert.ok(newChatImperative.length > 0, "newChat imperative handler must be present");

assert.match(
  newChatImperative,
  /setComposeInstance\(\(n\) => n \+ 1\)/,
  "imperative newChat must increment composeInstance before opening the compose view",
);

// ── 3. ChatList onNewChat increments ─────────────────────────────────────────

const chatListOnNewChat =
  routerSource.match(/onNewChat=\{\(projectRoot, familiarId\) => \{[\s\S]*?\}\}/)?.[0] ?? "";

assert.ok(chatListOnNewChat.length > 0, "ChatList onNewChat handler must be present in router");

assert.match(
  chatListOnNewChat,
  /setComposeInstance\(\(n\) => n \+ 1\)/,
  "ChatList onNewChat must increment composeInstance",
);

// ── 4. ChatProjectSidebar onNewChat increments ───────────────────────────────

const sidebarOnNewChat =
  routerSource.match(/onNewChat=\{\(root\) => \{[\s\S]*?\}\}/)?.[0] ?? "";

assert.ok(sidebarOnNewChat.length > 0, "ChatProjectSidebar onNewChat handler must be present in router");

assert.match(
  sidebarOnNewChat,
  /setComposeInstance\(\(n\) => n \+ 1\)/,
  "ChatProjectSidebar onNewChat must increment composeInstance",
);

// ── 5. Familiar-switch increments when creating a new null-session compose ───

const familiarSwitchEffect =
  routerSource.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[familiar\?\.id\]\);/)?.[0] ?? "";

assert.ok(familiarSwitchEffect.length > 0, "familiar-switch effect must be present");

assert.match(
  familiarSwitchEffect,
  /setComposeInstance\(\(n\) => n \+ 1\)/,
  "familiar-switch must increment composeInstance when creating a new null-session compose",
);

assert.match(
  familiarSwitchEffect,
  /viewRef\.current/,
  "familiar-switch must read viewRef.current to detect whether a new compose will be opened",
);

assert.match(
  familiarSwitchEffect,
  /currentView\.kind === "chat"[\s\S]*?currentView\.familiarId !== nextFamiliarId/,
  "familiar-switch increments only when switching to a different familiar while already in chat mode",
);

// ── 6. Session promotion does NOT increment the nonce ────────────────────────

const sessionStartedHandler =
  routerSource.match(/onSessionStarted=\{\(sid,\s*originSessionId\) => \{[\s\S]*?\}\}/)?.[0] ?? "";

assert.ok(sessionStartedHandler.length > 0, "onSessionStarted handler must be present in router");

assert.doesNotMatch(
  sessionStartedHandler,
  /setComposeInstance/,
  "session promotion (onSessionStarted) must NOT increment composeInstance — the stream must survive the null→sessionId transition",
);

// ── 7. Voice-session discard increments (returns to a fresh compose) ─────────

const voiceDiscardHandler =
  routerSource.match(/onVoiceSessionDiscarded=\{\(\) => \{[\s\S]*?\}\}/)?.[0] ?? "";

assert.ok(voiceDiscardHandler.length > 0, "onVoiceSessionDiscarded handler must be present in router");

assert.match(
  voiceDiscardHandler,
  /setComposeInstance\(\(n\) => n \+ 1\)/,
  "onVoiceSessionDiscarded must increment composeInstance (discarded voice chat → new blank compose)",
);

// ── 8. Voice-session creation does NOT increment ─────────────────────────────

const voiceCreatedHandler =
  routerSource.match(/onVoiceSessionCreated=\{\(sid\) => \{[\s\S]*?\}\}/)?.[0] ?? "";

assert.ok(voiceCreatedHandler.length > 0, "onVoiceSessionCreated handler must be present in router");

assert.doesNotMatch(
  voiceCreatedHandler,
  /setComposeInstance/,
  "onVoiceSessionCreated must NOT increment composeInstance — it is a promotion, not a new compose",
);

// ── 9. Primary ChatView is keyed by composeInstance ───────────────────────────

const primaryChatViewRendering =
  routerSource.match(/<ChatView(?![A-Za-z])[\s\S]*?key=\{`[^`]*composeInstance[^`]*`\}[\s\S]*?\/>/)?.[0] ?? "";

assert.ok(
  primaryChatViewRendering.length > 0,
  "Primary ChatView must have a key prop that includes composeInstance so it remounts on nonce change",
);

// ── 10. Session promotion does NOT cause a remount ─────────────────────────────

assert.doesNotMatch(
  primaryChatViewRendering,
  /key=\{[^}]*sessionId[^}]*\}/,
  "ChatView key must not include sessionId — session promotion (null→assigned) must not remount",
);

assert.match(
  primaryChatViewRendering,
  /key=\{`chat-compose-\$\{composeInstance\}`\}/,
  "The primary ChatView key must name the stable compose lineage rather than using an opaque numeric key",
);

// ── 11. Changing the compose key unmounts all old local state synchronously ───

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mountedInstances: Array<{
  label: string;
  transcript: string[];
  stream: { aborted: boolean };
}> = [];
const unmountedInstances: string[] = [];

function StatefulChatViewProbe({ label }: { label: string }) {
  const [transcript] = useState([label]);
  const stream = useRef({ aborted: false });

  useLayoutEffect(() => {
    mountedInstances.push({ label, transcript, stream: stream.current });
    return () => {
      stream.current.aborted = true;
      unmountedInstances.push(label);
    };
  }, []);

  return createElement("div", null, transcript.join(""));
}

let renderer;
await act(async () => {
  renderer = create(createElement(StatefulChatViewProbe, {
    key: "chat-compose-1",
    label: "old transcript",
  }));
});
const oldInstance = mountedInstances[0];

await act(async () => {
  renderer.update(createElement(StatefulChatViewProbe, {
    key: "chat-compose-2",
    label: "fresh transcript",
  }));
});

assert.deepEqual(unmountedInstances, ["old transcript"], "null→null compose key change unmounts the old ChatView");
assert.equal(oldInstance.stream.aborted, true, "old ChatView stream cleanup runs during keyed replacement");
assert.deepEqual(
  mountedInstances[1]?.transcript,
  ["fresh transcript"],
  "the replacement ChatView starts with isolated transcript state",
);

await act(async () => {
  renderer.update(createElement(StatefulChatViewProbe, {
    key: "chat-compose-2",
    label: "ordinary active-session rerender",
  }));
});

assert.deepEqual(
  unmountedInstances,
  ["old transcript"],
  "an ordinary rerender in the same compose lineage does not remount ChatView",
);
assert.deepEqual(
  mountedInstances[1]?.transcript,
  ["fresh transcript"],
  "ordinary active-session rerenders retain the current transcript",
);

await act(async () => renderer.unmount());

// ── 12. ChatView relies on keyed unmount, not passive nonce observation ────────

assert.doesNotMatch(
  viewSource,
  /composeInstance\?: number|isFirstComposeInstanceRef|\[composeInstance\]/,
  "ChatView must not passively observe composeInstance; the router key owns compose replacement",
);

// ── 13. viewRef kept in sync ──────────────────────────────────────────────────

assert.match(
  routerSource,
  /const viewRef = useRef<View>\(view\)/,
  "ChatRouter must declare viewRef to track the current view without stale closures",
);

assert.match(
  routerSource,
  /viewRef\.current = view;/,
  "viewRef.current must be updated synchronously in the render body to stay current",
);

console.log("chat-compose-instance.test.ts: ok");
