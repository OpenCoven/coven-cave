// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dock = await readFile(new URL("./code-context-dock.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");

for (const tab of ["changes", "files", "pr", "inspector", "github", "browser"]) {
  assert.match(dock, new RegExp(`id: "${tab}"`), `the context dock exposes ${tab}`);
}

for (const modulePath of [
  "@/components/code-workbench-files",
  "@/components/code-session-pr-panel",
  "@/components/code-inspector",
  "@/components/github-view",
  "@/components/browser-pane",
]) {
  assert.ok(dock.includes(`import("${modulePath}")`), `${modulePath} stays lazy inside the dock`);
}

assert.match(dock, /openTarget\?\.kind === "changes" \? "changes" : "files"/, "file and diff opens select the matching context tab");
assert.match(dock, /pendingGithubOpen[\s\S]*?setTab\("github"\)/, "pending GitHub navigation opens the dock's GitHub tab");
assert.match(dock, /initialFilter=\{GITHUB_TAB_FILTER\[pendingGithubOpen\.tab\]\}/, "GitHub collection intent reaches the shared Room GitHub view");
assert.match(dock, /initialTarget=\{pendingGithubOpen\.target\}/, "GitHub item detail reaches the shared Room GitHub view");
assert.match(
  dock,
  /<LazyBrowserPane[\s\S]*?label=\{`code-browser-\$\{row\.id\}`\}[\s\S]*?active=\{tab === "browser"\}/,
  "Browser uses a session-scoped native label and only activates on its dock tab",
);
assert.match(dock, /onRequestExpand\(\)/, "opening Browser requests an expanded dock");
assert.match(dock, /aria-label=\{expanded \? "Restore context panel width" : "Expand context panel"\}/, "dock expansion has a state-aware accessible name");
assert.match(dock, /aria-label="Close context panel"/, "the context dock can collapse out of the terminal workspace");

assert.match(workbench, /import \{ Group, Panel, Separator, usePanelRef \} from "react-resizable-panels"/, "the workbench owns a resizable terminal/context split");
assert.match(workbench, /<CodeTerminalWorkspace[\s\S]*?sessionId=\{row\.id\}[\s\S]*?projectRoot=\{workRoot\}/, "the terminal workspace is the main middle panel");
assert.match(workbench, /<CodeContextDock[\s\S]*?row=\{row\}/, "the right panel mounts the context dock");
assert.match(workbench, /contextPanelRef\.current\?\.resize\(expanded \? "36%" : "56%"\)/, "expand/restore resizes the right split");
assert.match(workbench, /<Separator[\s\S]*?<SeparatorHandle orientation="col"/, "the terminal/context divider uses the shared separator");

console.log("code-context-dock.test.ts: ok");
