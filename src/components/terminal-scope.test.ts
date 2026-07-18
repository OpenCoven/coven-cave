// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const workspaceMode = read("../lib/workspace-mode.ts");
const workspace = read("./workspace.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const settings = read("./settings-shell.tsx");
const config = read("../lib/cave-config.ts");
const projectDetail = read("./projects/project-detail.tsx");
const slashCommands = read("../lib/slash-commands.ts");
const screenshotCapture = read("../../scripts/capture-screenshots.mjs");

assert.doesNotMatch(workspaceMode, /[|]\s*"terminal"/, "terminal is not a standalone WorkspaceMode");
assert.doesNotMatch(workspace, /terminal:\s*"Terminal"/, "workspace title map does not expose a Terminal page");
assert.doesNotMatch(workspace, /setMode\("terminal"\)/, "workspace never navigates to a standalone Terminal page");
assert.doesNotMatch(workspace, /mode === "terminal"/, "workspace does not branch around a standalone Terminal page");
assert.doesNotMatch(sidebar, /id:\s*"terminal"/, "sidebar has no Terminal nav row");
assert.doesNotMatch(settings, /key:\s*"terminal"/, "settings add-ons do not expose Terminal as an add-on");
assert.doesNotMatch(config, /terminal\?:\s*boolean|terminal:\s*false|terminal:\s*parsed\.addons\?\.terminal/, "config has no terminal add-on flag");
assert.doesNotMatch(projectDetail, /openTerminalHere|Terminal/, "the project detail pane does not offer a standalone terminal action");
assert.doesNotMatch(slashCommands, /\/terminal|\/comux|integrated terminal view/i, "slash commands do not open a standalone Terminal page");
assert.doesNotMatch(screenshotCapture, /Terminal surface|click:\s*"Terminal"/, "screenshot capture does not target a standalone Terminal page");

console.log("terminal-scope.test.ts OK");
