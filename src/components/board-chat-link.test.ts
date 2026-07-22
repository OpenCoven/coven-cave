// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const boardView = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const boardInspector = await readFile(new URL("./board-inspector.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/board/[id]/chat/route.ts", import.meta.url), "utf8");
const chatSendRoute = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");

assert.match(
  boardView,
  /onOpenTaskChat/,
  "BoardView should expose a task chat action",
);
assert.match(
  boardView,
  /fetch\(`\/api\/board\/\$\{id\}\/chat`, \{[\s\S]*method: "POST"/,
  "Task chat action should POST to the board chat link endpoint",
);
assert.match(
  boardView,
  /if \(card\?\.projectId && !card\.familiarId\) \{[\s\S]{0,260}Choose an authorized familiar before starting work in this project\.[\s\S]{0,180}return null;[\s\S]{0,260}const fallbackFamiliarId = card\?\.familiarId \?\? activeFamiliarId/,
  "project-backed task work must not fall back to an unrelated active familiar when no authorized familiar is assigned",
);
assert.doesNotMatch(
  boardView,
  /onJumpToSession\?\.\(json\.sessionId, json\.familiarId/,
  "Starting task work should not navigate the desktop Tasks surface into general Chat",
);
assert.match(
  boardView,
  /const \[workCardId, setWorkCardId\] = useState<string \| null>\(null\)/,
  "BoardView should own the selected task work cockpit",
);
assert.match(
  boardView,
  /const openTaskWork = async \(id: string\) =>/,
  "BoardView should expose one task-scoped work entry path",
);
assert.match(
  boardView,
  /if \(card\.sessionId && !card\.projectId\)/,
  "project-backed task sessions must revisit the board endpoint for current authorization before opening",
);
assert.match(
  boardView,
  /if \(isMobile\)[\s\S]*onJumpToSession\?\.\(/,
  "Mobile should preserve the existing general Chat fallback",
);
assert.match(
  boardView,
  /setWorkCardId\(id\)/,
  "Desktop task work should open in place",
);
assert.match(
  boardView,
  /<TaskWorkCockpit/,
  "BoardView should render the focused work cockpit",
);
assert.match(
  boardView,
  /onRefreshSessions=\{onSessionsChanged\}/,
  "The task cockpit should reuse Workspace's session refresh",
);
assert.match(
  boardView,
  /const project = card\?\.projectId \? chatProjectById\(card\.projectId, projects\) : null;[\s\S]{0,420}await startTaskChat\(id, project\?\.root\)/,
  "Task work for project-assigned cards should start in the assigned project root",
);
assert.match(
  boardInspector,
  /Start work|Open work/,
  "Board inspector should present task-scoped work entry copy",
);
assert.match(
  boardInspector,
  /onOpenTaskWork\?\.\(card\.id/,
  "Board inspector work action should call the task cockpit callback",
);
assert.match(
  route,
  /card\.sessionId/,
  "Board chat endpoint should reuse an existing card session link",
);
assert.match(
  route,
  /buildInitialTaskChatPrompt\(card\)/,
  "Board chat endpoint should seed new sessions with task context",
);
assert.match(
  route,
  /normalizeProjectRoot\(rawProjectRoot\)|projectRoot = normalizeProjectRoot\(assignedProject\.root\)/,
  "Board chat endpoint normalizes the resolved project root",
);
assert.match(
  route,
  /projectById\(card\.projectId, await loadProjects\(\)\)[\s\S]{0,900}assertProjectAccess\(\{ familiarId \}, assignedProject\.id, "session-launch"\)/,
  "Board chat endpoint should resolve assigned project roots server-side and authorize the familiar",
);
assert.match(
  route,
  /assertProjectAccess\(\{ familiarId \}, assignedProject\.id, "session-launch"\)[\s\S]{0,700}if \(card\.sessionId\) \{[\s\S]{0,300}reused: true/,
  "a project-linked session is reused only after the current familiar passes project authorization",
);
assert.match(
  route,
  /project root does not match assigned task project/,
  "Board chat endpoint rejects a client-supplied root that disagrees with the assigned project",
);
assert.doesNotMatch(
  route,
  /process\.cwd\(\)/,
  "Board chat endpoint must never fall back to the app's own working directory",
);
assert.match(
  route,
  /callDaemon<\{ id: string; status: string \}>/,
  "Board chat endpoint should create a real daemon session when a card is unlinked",
);
assert.match(
  route,
  /updateCard\(card\.id, \{\s*sessionId/,
  "Board chat endpoint should persist the relation on the board card",
);
assert.match(
  route,
  /recordSessionFamiliar/,
  "Board chat endpoint should record the familiar-session relation",
);
assert.match(
  chatSendRoute,
  /taskContextForSession\(body\.sessionId/,
  "Chat send should look up task context for task-linked sessions",
);
assert.match(
  chatSendRoute,
  /buildTaskAwarePrompt\(\s*(?:buildPromptWithKnowledgeVault\(\s*)?(?:buildPromptWithFamiliarStartupContext\([\s\S]{0,120})?(?:appendMentionedFilesBlock\(\s*)?buildPromptWithAttachments/,
  "Chat send should include task context in the harness prompt only",
);
