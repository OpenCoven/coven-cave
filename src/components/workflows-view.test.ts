import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");

assert.doesNotMatch(workspace, /import \{ WorkflowsView \}/, "Workspace should not import the legacy Workflows page");
assert.doesNotMatch(workspace, /mode === "workflows"/, "Workspace should not route to a Workflows page");
assert.doesNotMatch(workspace, /setMode\("workflows"\)/, "Workspace should not navigate into the removed Workflows page");
assert.doesNotMatch(sidebar, /\{ id: "workflows", label: "Workflows"/, "Sidebar should not expose Workflows as a page");
assert.doesNotMatch(mode, /\|\s*"workflows"/, "WorkspaceMode should not include the removed Workflows page");

assert.match(client, /\/api\/workflows/, "Workflow API client remains for roles and stored manifests during migration");

console.log("workflows-view.test.ts: removed-page contract OK");
