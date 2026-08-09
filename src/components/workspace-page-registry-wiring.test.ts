import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

test("workspace stores normalized split pane requests", () => {
  assert.match(source, /import \{[\s\S]*normalizeWorkspacePaneRequest[\s\S]*workspacePaneRequestKey[\s\S]*\} from "@\/lib\/workspace-pane-request"/);
  assert.match(source, /useState<WorkspacePaneRequest\[\]>\(\[\]\)/);
  assert.match(source, /normalizeWorkspacePaneRequest\(nextPaneInstanceId\(\), m\)/);
  assert.match(source, /addSecondaryWorkspaceTile\(prev, target, workspacePaneRequestKey\)/);
  assert.doesNotMatch(source, /type SplitTarget/);
});

test("workspace titles and split state derive from the page registry", () => {
  assert.match(source, /workspacePageDefinition\(request\.requestedPageId\)/);
  assert.match(source, /workspacePageDefinition\(mode\)/);
  assert.doesNotMatch(source, /const WORKSPACE_MODE_TITLES: Record/);
});
