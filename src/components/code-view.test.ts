// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Retirement guard for the standalone Code workspace mode. Coding affordances
// now live inside Chat's repo-aware rail and the Library/Projects browser; the
// web shell must not expose a separate "code" WorkspaceMode, sidebar row, addon,
// command-palette row, CodeView branch, or ChatSurface surface switch.

await assert.rejects(
  readFile(new URL("./code-view.tsx", import.meta.url), "utf8"),
  /ENOENT/,
  "CodeView source should stay deleted",
);

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const commandPalette = await readFile(new URL("./command-palette.tsx", import.meta.url), "utf8");
const settingsShell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");

assert.doesNotMatch(modeType, /\|\s*"code"/, "WorkspaceMode should not include retired code mode");
assert.doesNotMatch(workspace, /import \{ CodeView \}|<CodeView|mode === "code" \? \(/, "Workspace should not import or render CodeView");
assert.doesNotMatch(
  workspace,
  /code: "Code"|codeRightView|lastNonCodeMode|exitCodeMode|codeSidebar|storageNamespace=":code"|surface="code"/,
  "Workspace should not keep retired Code workspace state/wiring",
);
assert.doesNotMatch(sidebar, /id: "code"|addons\?\.code|code\?: boolean/, "Sidebar should not expose or gate a Code surface");
assert.doesNotMatch(commandPalette, /fm\.id === "code"|addons\?\.code|Go to Code/, "Command palette should not expose a Code surface row");
assert.doesNotMatch(
  settingsShell,
  /\|\s*"code"|key: "code"|label: "Code"[\s\S]{0,80}icon: "ph:code"/,
  "Settings add-ons should not offer a Code surface toggle",
);

assert.match(
  workspace,
  /if \(targetMode === "code"\) \{[\s\S]*?filter\(\(s\) => s\.project_root\)[\s\S]*?openFamiliarSession\(repoSession\.id, repoSession\.familiarId\)[\s\S]*?setMode\("chat"\)/,
  "legacy code deep-links should redirect to the newest repo chat or Chat fallback",
);
assert.match(
  workspace,
  /if \(m === "terminal"\) return;[\s\S]*?setMode\("terminal"\)[\s\S]*?cave:open-project-file/,
  "file-open events should target Terminal/Projects after Code mode retirement",
);
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser", "terminal",\s*\]/,
  "keyboard surface order should end at Terminal (Cmd/Ctrl+6)",
);
assert.match(workspace, /nav=\{mode === "chat" \? chatSidebar : sidebar\}/, "only chat mode swaps the primary nav for WorkspaceSidebar");

assert.doesNotMatch(
  chatSurface,
  /surface\s*=\s*"chat"|surface === "code"|isCodeSurface|CodeInlineToolbar|data-surface=\{surface\}/,
  "ChatSurface should not keep a code-surface branch",
);
assert.match(chatSurface, /const compactRail = hideThreadRail/, "ChatSurface compact mode is driven only by hideThreadRail");
assert.match(chatSurface, /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/, "Chat keeps Projects as its second primary tab");

assert.doesNotMatch(chatRouter, /surface\?:|surface=\{surface\}/, "ChatRouter should not forward a retired surface prop");
assert.doesNotMatch(chatView, /surface\?:|surface === "code"|Ask for follow-up changes/, "ChatView should not keep Code-specific composer copy");

console.log("code-view.test.ts: ok");
