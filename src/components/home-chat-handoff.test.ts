// @ts-nocheck
// Home-screen chat handoff: a prompt submitted from the HomeComposer must be
// sent by ChatView's streaming path, not by a fire-and-cancel fetch in the
// composer. The old pattern (fetch /api/chat/send, reader.cancel() on the
// session event, then navigate) aborted the request — the route killed the
// harness on abort and never saved the transcript, so the opened chat 404'd
// with "Chat history unavailable".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pendingAction = await readFile(
  new URL("../lib/pending-chat-action.ts", import.meta.url),
  "utf8",
);
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const surface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const router = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  pendingAction,
  /kind: "new";[^}]*initialPrompt\?: string \| null/s,
  "PendingChatAction 'new' should carry an optional initialPrompt for home-screen handoff",
);

assert.match(
  workspace,
  /onStartChat=\{/,
  "Workspace should wire HomeComposer.onStartChat to open a new chat with the prompt",
);

assert.match(
  surface,
  /newChat\(\s*pendingChatAction\.projectRoot \?\? undefined,\s*pendingChatAction\.initialPrompt \?\? undefined,\s*pendingChatAction\.familiarId,\s*undefined,\s*pendingChatAction\.initialControls \?\? undefined,\s*\)/s,
  "ChatSurface should forward the pending initialPrompt into ChatRouter.newChat",
);

assert.match(
  router,
  /initialPrompt\?: string/,
  "ChatRouter view state should carry initialPrompt through to ChatView",
);

assert.match(
  view,
  /initialPrompt/,
  "ChatView should accept an initialPrompt prop",
);

assert.match(
  view,
  /initialPromptSentRef/,
  "ChatView should auto-send the initial prompt exactly once (ref-guarded against strict-mode double effects)",
);
