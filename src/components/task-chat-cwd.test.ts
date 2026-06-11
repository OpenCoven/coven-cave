// @ts-nocheck
// New chats can specify a working directory, and task chats run in the CWD
// tied to the task — prompting (optionally) for one when the card has none.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const boardView = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const taskChatRoute = readFileSync(
  new URL("../app/api/board/[id]/chat/route.ts", import.meta.url),
  "utf8",
);

// ── New chat: user-specified CWD ─────────────────────────────────────────────

assert.match(
  chatView,
  /const \[cwdDraft, setCwdDraft\] = useState\(""\)/,
  "ChatView keeps a CWD draft for not-yet-started chats",
);
assert.match(
  chatView,
  /projectRoot: cwdDraft\.trim\(\) \|\| projectRoot/,
  "First send prefers the user-typed CWD over the pre-wired projectRoot",
);
assert.match(
  chatView,
  /onCwdChange=\{!sessionId \? setCwdDraft : undefined\}/,
  "The CWD field is only editable before the session exists",
);
assert.match(
  chatView,
  /aria-label="Working directory for this chat"/,
  "Empty state exposes a labeled working-directory input",
);

// ── Task chat: card CWD wins; optional prompt when absent ───────────────────

assert.match(
  taskChatRoute,
  /card\.cwd \?\? body\.projectRoot \?\? process\.cwd\(\)/,
  "Task chat sessions start in the card's CWD when it has one",
);
assert.match(
  taskChatRoute,
  /!card\.cwd && body\.projectRoot \? \{ cwd: body\.projectRoot \}/,
  "A start-time CWD is persisted onto the card",
);
assert.match(
  boardView,
  /if \(card && !card\.sessionId && !card\.cwd\) \{\s*\n\s*setCwdPromptCardId\(id\);/,
  "Starting a task chat for a CWD-less card prompts instead of POSTing immediately",
);
assert.match(
  boardView,
  /Skip[\s\S]*?Set &amp; start/,
  "The prompt is optional — Skip starts without a CWD, Set & start uses the typed one",
);
assert.match(
  boardView,
  /onStart\(trimmed \? trimmed : undefined\)/,
  "Submitting an empty path behaves like Skip",
);

console.log("task-chat-cwd.test.ts: ok");
