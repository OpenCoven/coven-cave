// @ts-nocheck
// Chats pick a persisted project, and that project owns the runtime root.
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
  /setProjectIdDraft\(\s*\(prev\)/,
  "ChatView seeds the selected project from the opened session or pending project root",
);
assert.match(
  chatView,
  /const selectedProject = projectIdDraft\s*\?\s*chatProjectById\(projectIdDraft, projects\) \?\? firstProject\s*:\s*firstProject/,
  "ChatView resolves the selected project through the persisted project registry",
);
assert.match(
  chatView,
  /const activeProjectRoot = selectedProject\?\.root \?\? session\?\.project_root \?\? projectRoot \?\? ""/,
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
  /projects\.map\(\(project\) => \([\s\S]*?<option key=\{project\.id\} value=\{project\.id\}>[\s\S]*?\{project\.name\}/,
  "Empty state renders the live project list",
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

// ── Task chat: card CWD wins; project selection when absent ─────────────────

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
  "Starting a task chat for a CWD-less card prompts for project selection instead of POSTing immediately",
);
assert.match(
  boardView,
  /projects\.map\(\(project\) => \([\s\S]*?<option key=\{project\.id\} value=\{project\.id\}>/,
  "The task chat prompt should render the persisted project registry, not a free-form path input",
);
assert.match(
  boardView,
  /const selectedProject = projectId \? chatProjectById\(projectId, projects\) \?\? firstProject : firstProject/,
  "The selected task-chat project should resolve through the shared project registry",
);
assert.match(
  boardView,
  /onStart\(selectedProject\.root\)/,
  "Starting from the prompt should pass the selected project root",
);
assert.match(
  boardView,
  /aria-label="Project for this task chat"/,
  "The task chat prompt should expose a labeled project selector",
);
assert.doesNotMatch(
  boardView,
  /Set a working directory|Working directory for this task chat|\/path\/to\/project|Set &amp; start/,
  "The task chat prompt should not expose working-directory copy or a free-form path action",
);

console.log("task-chat-cwd.test.ts: ok");
