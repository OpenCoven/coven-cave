// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");
const dock = await readFile(new URL("./code-context-dock.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./code-session-rail.tsx", import.meta.url), "utf8");

assert.doesNotMatch(codeView, /role="tablist"\s+aria-label="Code surface"/, "GitHub no longer replaces the whole Room through top-level tabs");
assert.match(codeView, /<CodeSessionRail[\s\S]*?<CodeWorkbench/, "the Room composes the session rail and selected-session workbench");
assert.match(codeView, /const \[githubOpen, setGithubOpen\] = useState/, "the Room retains consumed GitHub navigation for the dock");
assert.match(codeView, /setGithubOpen\(pendingGithubOpen\)/, "pending GitHub navigation is copied into Room state");
assert.match(codeView, /onPendingGithubOpenHandled\?\.\(\)/, "the external GitHub request is consumed after capture");
assert.match(
  codeView,
  /<CodeWorkbench[\s\S]*?pendingGithubOpen=\{githubOpen\}[\s\S]*?onFocusCard=\{onFocusCard\}/,
  "the selected workbench receives GitHub context and task navigation",
);
assert.match(workbench, /<CodeTerminalWorkspace/, "terminals remain the center of the selected session");
assert.match(workbench, /<CodeContextDock/, "diffs, files, GitHub, and Browser remain in the right dock");
assert.match(workbench, /useIsMobile\(\)/, "the selected-session layout responds to compact shell widths");
assert.match(workbench, /const \[mobilePane, setMobilePane\] = useState<"terminal" \| "context">/, "compact layouts drill between terminal and context");
assert.match(workbench, /aria-label="Coding workspace pane"/, "the compact Terminal/Context switch is an accessible tablist");
assert.match(workbench, /allowSplits=\{!isMobile\}/, "terminal splitting is disabled when compact panes cannot stay usable");
assert.match(workbench, /resizable=\{!isMobile\}/, "the context dock hides desktop resize actions in compact mode");
assert.match(codeView, /const showWorkbench = Boolean\(selected \|\| githubOpen\)/, "GitHub can open inside an otherwise empty Coding Room");
assert.match(codeView, /<CodeRoomGithub[\s\S]*?pendingGithubOpen=\{githubOpen\}/, "an empty Room renders the shared GitHub dock content");
assert.match(codeView, /onOpenGithub=\{\(\) => setGithubOpen/, "the session rail can enter GitHub without an existing session");
assert.match(rail, /onOpenGithub[\s\S]*?>\s*Open GitHub\s*</, "the empty rail exposes GitHub as a Room action");
assert.match(dock, /type CodeContextTab/, "legacy workbench deep links can map into context tabs");
assert.match(codeView, /workbenchTab === "diff" \? "changes"/, "legacy Diff deep links open the Changes dock tab");
assert.match(codeView, /aria-label="Back to sessions"/, "mobile can return from the workbench to the session rail");

console.log("code-room-layout.test.ts: ok");
