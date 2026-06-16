// @ts-nocheck
// Chats pick a persisted project, and that project owns the runtime root.
// Task chats still honor the task's stored cwd for existing board cards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const boardView = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const boardInspector = readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8");
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
  /const resolvedProjectId = projectIdDraft \?\? projectIdForRoot\(session\?\.project_root \?\? projectRoot, projects\);[\s\S]*const selectedProject = resolvedProjectId\s*\?\s*chatProjectById\(resolvedProjectId, projects\) \?\? firstProject\s*:\s*firstProject/,
  "ChatView resolves the selected project from the session/root before falling back to the first persisted project",
);
assert.match(
  chatView,
  /const activeProjectRoot = selectedProject\?\.root \?\? session\?\.project_root \?\? projectRoot \?\? ""/,
  "ChatView sends the selected project's configured root",
);
assert.match(
  chatView,
  /onProjectRootChange\?\.\(activeProjectRoot \|\| null\)/,
  "ChatView reports the same active project root used by send so the rail can stay in sync",
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
  /function SessionOverflowMenu[\s\S]*projects\.map\(\(entry\) => \([\s\S]*onSelect=\{\(\) => \{\s*onProjectChange\(entry\.id\)/,
  "Active chats expose project switching through the session overflow menu",
);
assert.match(
  chatView,
  /sessionId && \(\s*<SessionOverflowMenu[\s\S]*projectId=\{projectIdDraft\}[\s\S]*onProjectChange=\{setProjectIdDraft\}/,
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
  /const project = card\.projectId \? chatProjectById\(card\.projectId, projects\) : null;[\s\S]{0,180}await startTaskChat\(id, project\.root\);/,
  "Starting a task chat for a card with only a projectId should use the project's root without a follow-up dialog",
);
assert.match(
  boardInspector,
  /<div className="board-drawer-field-label">Project<\/div>[\s\S]{0,900}onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/,
  "The task Project field should set the runtime root for chat starts",
);
assert.match(
  boardInspector,
  /onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/,
  "Changing the task project should persist both projectId and cwd",
);
assert.match(
  boardInspector,
  /projects\.map\(\(project\) =>[\s\S]{0,120}<option key=\{project\.id\} value=\{project\.id\}>[\s\S]{0,120}\{project\.name\}/,
  "The task project picker should render the persisted project registry",
);
assert.doesNotMatch(
  boardInspector,
  /<div className="board-drawer-field-label"><Icon name="ph:folder" width=\{11\} \/> CWD<\/div>|aria-label="Project root for this task CWD"|board-drawer-path-preview/,
  "The inspector should not expose a separate CWD field below Chat",
);
assert.match(
  boardView,
  /Set a project before starting chat\./,
  "CWD-less task chat starts should direct the user to the task Project field",
);
assert.match(
  boardView,
  /if \("cwd" in patch \|\| "projectId" in patch\) setChatLinkError\(null\);/,
  "Changing the task project should clear the inline start-chat error",
);
assert.doesNotMatch(
  boardView,
  /TaskChatCwdPrompt|setCwdPromptCardId|aria-label="Select a project for this task chat"/,
  "Task chat project selection should live in the task CWD field, not a follow-up dialog",
);

console.log("task-chat-cwd.test.ts: ok");
