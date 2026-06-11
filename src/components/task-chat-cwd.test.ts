// @ts-nocheck
// Chats pick a predetermined project, and that project owns the runtime root.
// Task chats still honor the task's stored cwd for existing board cards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const boardView = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const taskChatRoute = readFileSync(
  new URL("../app/api/board/[id]/chat/route.ts", import.meta.url),
  "utf8",
);

// ── Chat: predetermined project ──────────────────────────────────────────────

assert.match(
  chatView,
  /const \[projectIdDraft, setProjectIdDraft\] = useState\(\(\) => projectIdForRoot\(session\?\.project_root \?\? projectRoot\) \?\? DEFAULT_CHAT_PROJECT_ID\)/,
  "ChatView seeds the selected project from the opened session or pending project root",
);
assert.match(
  chatView,
  /const selectedProject = chatProjectById\(projectIdDraft\) \?\? DEFAULT_CHAT_PROJECT/,
  "ChatView resolves the selected project through the predetermined project registry",
);
assert.match(
  chatView,
  /const activeProjectRoot = selectedProject\.root/,
  "ChatView sends the selected project's configured root",
);
assert.match(
  chatView,
  /projectRoot: activeProjectRoot/,
  "Every send includes the selected project's root",
);
assert.match(
  chatView,
  /onProjectChange=\{setProjectIdDraft\}/,
  "The project selector remains editable after the session exists",
);
assert.match(
  chatView,
  /function InlineProjectField[\s\S]*aria-label="Project for this chat"/,
  "Active chats expose a compact project selector in the header",
);
assert.match(
  chatView,
  /sessionId && \(\s*<>\s*<InlineProjectField[\s\S]*projectId=\{projectIdDraft\}[\s\S]*onProjectChange=\{setProjectIdDraft\}/,
  "The active-chat project selector shares the same draft used by send",
);
assert.match(
  chatView,
  /aria-label="Project for this chat"/,
  "Empty state exposes a labeled project selector",
);
assert.doesNotMatch(
  chatView,
  /aria-label="Root directory for relative CWD"|aria-label="Working directory for this chat"/,
  "ChatView should not expose user-facing ROOT/CWD inputs for normal chats",
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
