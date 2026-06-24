import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const mode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");

assert.doesNotMatch(workspace, /import \{ WorkflowsView \}/, "Workspace should not import the legacy Workflows page");
assert.doesNotMatch(workspace, /mode === "workflows"/, "Workspace should not route to a Workflows page");
assert.doesNotMatch(workspace, /setMode\("workflows"\)/, "Workspace should not navigate into the removed Workflows page");
assert.doesNotMatch(sidebar, /\{ id: "workflows", label: "Workflows"/, "Sidebar should not expose Workflows as a page");
assert.doesNotMatch(mode, /\|\s*"workflows"/, "WorkspaceMode should not include the removed Workflows page");
assert.doesNotMatch(globals, /workflows\.css/, "Global CSS should not import the removed Workflow page styles");
assert.equal(existsSync(new URL("./workflows-view.tsx", import.meta.url)), false, "Legacy Workflows page component should be removed");
assert.equal(existsSync(new URL("./workflows", import.meta.url)), false, "Dedicated Workflow Studio components should be removed");

assert.match(client, /\/api\/workflows/, "Workflow API client remains for roles and stored manifests during migration");

console.log("workflows-view.test.ts: removed-page contract OK");
