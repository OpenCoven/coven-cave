// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const workspaceMode = read("../lib/workspace-mode.ts");
const workspace = read("./workspace.tsx");
const pageRegistry = read("../lib/workspace-page-registry.ts");
const navigation = read("../lib/workspace-navigation.ts");
const settings = read("./settings-shell.tsx");
const config = read("../lib/cave-config.ts");
const slashCommands = read("../lib/slash-commands.ts");
const screenshotCapture = read("../../scripts/capture-screenshots.mjs");

assert.doesNotMatch(workspaceMode, /[|]\s*"terminal"/, "terminal is not a standalone WorkspaceMode");
// Was `doesNotMatch(workspace, /terminal: "Terminal"/)`. That map is gone from
// workspace.tsx entirely, so the assertion had become vacuous — it passed by
// probing something that no longer exists. Terminal IS in the registry, but as a
// SUPPLEMENTAL page, not a workspace mode page; scoping the check to
// WORKSPACE_MODE_PAGES restores the original meaning (cave-ktvy0).
const modePages =
  pageRegistry.match(
    /const WORKSPACE_MODE_PAGES = freezePageMap\(\{[\s\S]*?\n\} satisfies Record<WorkspaceMode, WorkspacePageDefinition>\);/,
  )?.[0] ?? "";
assert.ok(modePages, "WORKSPACE_MODE_PAGES should be extractable");
assert.doesNotMatch(modePages, /\n  "?terminal"?: \{/, "terminal is not a workspace mode page");
assert.doesNotMatch(workspace, /setMode\("terminal"\)/, "workspace never navigates to a standalone Terminal page");
assert.doesNotMatch(workspace, /mode === "terminal"/, "workspace does not branch around a standalone Terminal page");
assert.doesNotMatch(navigation, /id:\s*"terminal"/, "the navigation registry has no Terminal row");
assert.doesNotMatch(settings, /key:\s*"terminal"/, "settings add-ons do not expose Terminal as an add-on");
assert.doesNotMatch(config, /terminal\?:\s*boolean|terminal:\s*false|terminal:\s*parsed\.addons\?\.terminal/, "config has no terminal add-on flag");
assert.doesNotMatch(slashCommands, /\/terminal|\/comux|integrated terminal view/i, "slash commands do not open a standalone Terminal page");
assert.doesNotMatch(screenshotCapture, /Terminal surface|click:\s*"Terminal"/, "screenshot capture does not target a standalone Terminal page");

console.log("terminal-scope.test.ts OK");
