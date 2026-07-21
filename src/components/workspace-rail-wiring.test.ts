// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chat = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const task = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");

assert.match(chat, /useWorkspaceRailController\(\{/);
assert.match(task, /useWorkspaceRailController\(\{/);
assert.match(controller, /useCodeRail\(\{/);
assert.match(controller, /projectRoot: effectiveProjectRoot/);
assert.match(controller, /terminalActive: terminalOpened/);
assert.match(controller, /browseActive: browseRootOverride !== null/);
assert.match(controller, /rail\.activeTab === "terminal" && rail\.open[\s\S]*setTerminalOpened\(true\)/);
assert.match(controller, /function stopRailTerminal[\s\S]*invoke\("pty_stop", \{ threadId \}\)/);
assert.match(controller, /function stopRailTerminal[\s\S]*killPtyBridge\(threadId\)/);
assert.match(controller, /setTerminalOpened\(false\)/);
assert.match(controller, /"cave:changes-refresh"/);
assert.match(controller, /fetchChangesSummary\(root, opts\)/);
assert.match(controller, /const effectiveProjectRoot = browseRootOverride \?\? projectRoot/);
assert.match(controller, /setBrowseRootOverride\(null\)/);
assert.match(controller, /useState<number \| null>\(null\)/);
assert.match(controller, /json\.files\?\.length \?\? 0/);
// Copilot review on #3601: inactive scopes must never report an open rail.
assert.match(
  controller,
  /const showInline = active && rail\.available && rail\.open && !isMobile && !paneNarrow/,
  "showInline gates on the active flag",
);
assert.match(
  controller,
  /const mobileAvailable = active && \(isMobile \|\| paneNarrow\) && rail\.available/,
  "mobileAvailable gates on the active flag",
);

for (const source of [chat, task]) {
  assert.match(source, /<WorkspaceRail/);
  assert.match(source, /changeCount=\{/);
  assert.match(source, /projectRoot=\{/);
  assert.match(source, /onSelectTab=\{/);
  assert.match(source, /onTogglePin=\{/);
}

assert.match(chat, /sessionId=\{snapshot\.sessionId \?\? null\}/);
assert.match(task, /sessionId=\{target\.session\.id\}/);
assert.match(chat, /onCollapse=\{collapseCodeRail\}/);
assert.match(task, /onCollapse=\{railController\.collapse\}/);
assert.match(chat, /rail\.available && !rail\.open/);
assert.match(task, /railController\.rail\.available[\s\S]*!railController\.rail\.open/);

console.log("workspace-rail-wiring.test.ts ok");
