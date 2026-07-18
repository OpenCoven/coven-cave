// @ts-nocheck
// Chats pick a persisted project, and that project owns the runtime root.
// Task chats honor the task's assigned project before any older stored cwd.
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
  /const projectSelection = resolveChatProjectSelection\(\{\s*draftId: projectIdDraft,\s*hasSession: Boolean\(session\),\s*sessionProjectRoot: session\?\.project_root,\s*fallbackProjectRoot: projectRoot,\s*taskProjectId: linkedContext\?\.task\?\.projectId,\s*taskCwd: linkedContext\?\.task\?\.cwd,\s*projects,\s*\}\);[\s\S]*const resolvedProjectId = projectSelection\.projectId;[\s\S]*const selectedProject = projectSelection\.project;/,
  "ChatView resolves the selected project through resolveChatProjectSelection, feeding the linked task's project (sessions in unregistered cwds are No project — behaviorally pinned in chat-projects.test.ts)",
);
// REGRESSION (2026-07-02): a session in an unregistered cwd must NOT default
// the picker to the first project — sending that root re-roots the next
// turn's cwd and forks the harness session (`--continue` misses).
assert.doesNotMatch(
  chatView,
  /const selectedProject = resolvedProjectId\s*\?\s*chatProjectById\(resolvedProjectId, projects\) \?\? firstProject\s*:\s*firstProject/,
  "The unconditional first-project fallback for existing sessions must stay gone",
);
assert.match(
  chatView,
  /function SessionOverflowMenu[\s\S]*?<ProjectPickerPopover[\s\S]*?allowNoProject/,
  "The overflow menu's picker offers an explicit No-project choice so a workspace session can stay (or become) project-less",
);
assert.match(
  chatView,
  /const activeProjectRoot =\s*resolvedProjectId === NO_PROJECT_ID \? "" : \(selectedProject\?\.root \?\? session\?\.project_root \?\? projectRoot \?\? ""\)/,
  "ChatView keeps an explicit No-project selection rootless instead of falling back to the opener/session root",
);
assert.match(
  chatView,
  /onProjectRootChange\?\.\(activeProjectRoot \|\| null\)/,
  "ChatView reports the same active project root used by send so the rail can stay in sync",
);
assert.match(
  chatView,
  /projectRoot: requestProjectRoot/,
  "Every send includes the selected project's root (vetted: an unregistered session-cwd echo is dropped so the server doesn't fail it closed)",
);
assert.match(
  chatView,
  /onProjectChange=\{setProjectIdDraft\}/,
  "The project selector remains editable after the session exists",
);
assert.match(
  chatView,
  /function SessionOverflowMenu[\s\S]*<ProjectPickerPopover[\s\S]*value=\{projectId\}[\s\S]*onChange=\{onProjectChange\}/,
  "Active chats expose project switching through the shared picker popover in the session overflow menu",
);
assert.match(
  chatView,
  /sessionId && \(\s*<SessionOverflowMenu[\s\S]*projectId=\{projectIdDraft\}[\s\S]*onProjectChange=\{setProjectIdDraft\}/,
  "The active-chat project selector shares the same draft used by send",
);
// The empty state (the familiar's starting page) lives in chat-empty-state.tsx
// since the task-aware extraction; its picker pins follow it there.
const chatEmptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
assert.match(
  chatEmptyState,
  /<ProjectPicker[\s\S]*?value=\{projectId \?\? null\}[\s\S]*?onChange=\{onProjectChange\}[\s\S]*?allowNoProject/,
  "Empty state renders the shared picker with an explicit No-project choice (a no-project chat is no longer a picker-less dead end)",
);
assert.match(
  chatEmptyState,
  /ariaLabel="Project for this chat"/,
  "Empty state exposes a labeled project selector",
);
assert.doesNotMatch(
  chatView,
  /aria-label="Root directory for relative CWD"|aria-label="Working directory for this chat"/,
  "ChatView should not expose user-facing ROOT/CWD inputs for normal chats",
);

// ── Task chat: assigned project wins; card CWD is the fallback ───────────────

assert.match(
  taskChatRoute,
  /body\.projectRoot \?\? cardProjectRoot \?\? card\.cwd|body\.projectRoot \?\? card\.cwd/,
  "Task chat sessions start in the assigned project root, then the card's own project, then its cwd",
);
// REGRESSION (2026-07-03): the route must never root a task chat in the app's
// own process.cwd() — that records coven-cave as the session's project_root
// and the chat picker then shows the wrong project for the task.
assert.doesNotMatch(
  taskChatRoute,
  /process\.cwd\(\)/,
  "The process.cwd() fallback for task-chat roots must stay gone",
);
assert.match(
  taskChatRoute,
  /projectById\(card\.projectId, await loadProjects\(\)\)/,
  "A card's stable projectId resolves server-side when the UI didn't send a root",
);
assert.match(
  taskChatRoute,
  /assertProjectAccess\(\{ familiarId \}, assignedProject\.id, "session-launch"\)/,
  "Task chat must authorize the familiar for the assigned project before launching",
);
assert.match(
  taskChatRoute,
  /assign a project to this task before starting chat/,
  "A projectless task chat start is refused instead of silently mis-rooted",
);
assert.match(
  taskChatRoute,
  /card\.projectId \|\| body\.projectRoot \? \{ cwd: projectRoot \}/,
  "The assigned project root is persisted onto the card for subsequent task-chat starts",
);
assert.match(
  boardView,
  /const project = card\?\.projectId \? chatProjectById\(card\.projectId, projects\) : null;[\s\S]{0,180}await startTaskChat\(id, project\.root\);/,
  "Starting a task chat for a card with projectId should use the project's root without a follow-up dialog",
);
assert.match(
  boardInspector,
  /<div className="board-drawer-field-label board-drawer-field-label--split">[\s\S]{0,120}<span>Project<\/span>[\s\S]{0,1100}onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/,
  "The task Project field should set the runtime root for chat starts",
);
assert.match(
  boardInspector,
  /onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/,
  "Changing the task project should persist both projectId and cwd",
);
assert.match(
  boardInspector,
  /<StandardSelect[\s\S]{0,120}label="Project"[\s\S]{0,260}value=\{card\.projectId \?\? ""\}[\s\S]{0,520}\{ value: "", label: "No project" \}[\s\S]{0,160}\.\.\.projects\.map\(\(project\) => \(\{ value: project\.id, label: project\.name \}\)\)/,
  "The task project picker should render the persisted project registry through the shared select",
);
assert.doesNotMatch(
  boardInspector,
  /<div className="board-drawer-field-label"><Icon name="ph:folder" width=\{11\} \/> CWD<\/div>|aria-label="Project root for this task CWD"|board-drawer-path-preview/,
  "The inspector should not expose a separate CWD field below Chat",
);
assert.match(
  boardView,
  /Choose a project for this task before starting chat, or open Projects to create one\./,
  "CWD-less task chat starts should direct the user to the task Project field and the project creation surface",
);
assert.match(
  boardInspector,
  /CHAT_OPEN_PROJECTS_EVENT/,
  "The task inspector should expose a path to the Projects surface",
);
assert.match(
  boardInspector,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "chat" \} \}\)/,
  "The task inspector's project action should navigate to Chat before opening the Projects tab",
);
assert.match(
  boardInspector,
  /window\.dispatchEvent\(new CustomEvent\(CHAT_OPEN_PROJECTS_EVENT\)\)/,
  "The task inspector's project action should open the Projects tab",
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

// ── Chat side: the linked task's project drives the picker (2026-07-03) ──────
// A chat tied to a board card must open in the card's project — not the first
// registered project, and not whatever cwd the session happened to be recorded
// in (a mis-rooted task chat displayed "Coven Cave" for a task belonging to a
// different project).
const linkedContextLib = readFileSync(
  new URL("../lib/chat-linked-context.ts", import.meta.url),
  "utf8",
);
assert.match(
  linkedContextLib,
  /projectId: card\.projectId \?\? null/,
  "The linked-task context carries the card's stable projectId through to the chat",
);
assert.match(
  chatView,
  /taskProjectId: linkedContext\?\.task\?\.projectId,\s*taskCwd: linkedContext\?\.task\?\.cwd,\s*projects,\s*\}\)\.projectId \?\?/,
  "The draft-init effect seeds the picker from the linked task's project once the context loads",
);
assert.match(
  chatView,
  /firstProject\?\.id, linkedContext\?\.task\?\.projectId, linkedContext\?\.task\?\.cwd\]/,
  "The draft-init effect re-seeds when the linked task arrives (it loads async with the conversation)",
);

// ── Projectless task cards get a "set a project" nudge (2026-07-03) ──────────
// A card with neither projectId nor cwd can't root its task chats: new starts
// are refused (409) and linked chats can't inherit a project. Surface that on
// the card face (desktop + mobile) and under the inspector's Project field.
const boardKanban = readFileSync(new URL("./board-kanban.tsx", import.meta.url), "utf8");
const boardCardStack = readFileSync(new URL("./board-card-stack.tsx", import.meta.url), "utf8");
assert.match(
  boardKanban,
  /const missingProject = !card\.projectId && !card\.cwd;/,
  "the kanban card derives its projectless state from both project fields",
);
assert.match(
  boardKanban,
  /board-kanban-card-chip--no-project/,
  "a projectless kanban card shows a No-project chip",
);
assert.match(
  boardKanban,
  /missingProject \? "no project set" : null,/,
  "the nudge is folded into the card's accessible name so AT users hear it",
);
assert.match(
  boardCardStack,
  /board-card-stack__row-no-project/,
  "the mobile card face mirrors the No-project nudge",
);
assert.match(
  boardInspector,
  /projects\.length > 0 && !card\.projectId && !card\.cwd \? \(/,
  "the inspector nudge shows only when a project could actually be picked (the empty-roster case has its own hint)",
);
assert.match(
  boardInspector,
  /board-drawer-field-hint--nudge/,
  "the inspector Project field carries the set-a-project nudge",
);

console.log("task-chat-cwd.test.ts: ok");
