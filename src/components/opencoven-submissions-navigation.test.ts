// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspaceMode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./opencoven-submission-page.tsx", import.meta.url), "utf8");

// The mode + page remain (reachable programmatically), but Submissions is hidden
// from the sidebar nav — it should no longer be listed as a Tools surface.
assert.match(workspaceMode, /\|\s*"submissions"/, "OpenCoven submissions should remain a workspace mode");
assert.doesNotMatch(
  sidebar,
  /\{ id: "submissions",/,
  "Sidebar should NOT expose Submissions as a nav item (it's hidden)",
);
assert.match(workspace, /submissions:\s*"Submissions"/, "Workspace h1 title map should cover submissions mode");
assert.match(workspace, /mode === "submissions" \?\s*\(\s*<OpenCovenSubmissionPage/, "Workspace should render the OpenCoven submission page directly");
assert.match(page, /OpenCovenSubmissionPanel/, "Submission page should own the reusable submission panel");
assert.match(page, /Submit once to OpenCoven/, "Submission page should state the corrected product flow");
assert.doesNotMatch(page, /clawhub|openclaw/i, "Submission page must not point to external publishing paths");

console.log("opencoven-submissions-navigation.test.ts: ok");
