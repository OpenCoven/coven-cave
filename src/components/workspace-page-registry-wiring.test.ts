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
  assert.match(source, /workspacePageDefinition\(primaryPaneRequest\?\.requestedPageId \?\? mode\)/);
  assert.match(source, /renderSurface\(request\.pageId, \{ variant: request\.variant, instanceId: request\.instanceId \}\)/);
  assert.doesNotMatch(source, /const WORKSPACE_MODE_TITLES: Record/);
});

test("workspace deep links use the same pane request path for both sides", () => {
  assert.match(source, /const \[primaryPaneRequest, setPrimaryPaneRequest\] = useState<WorkspacePaneRequest \| null>\(null\)/);
  assert.match(source, /readModeParam\(\)[\s\S]*readSplitPageParam\(\)/);
  assert.match(source, /normalizeWorkspacePaneRequest\("workspace-primary-link", target\)/);
  assert.match(source, /normalizeWorkspacePaneRequest\("workspace-secondary-link", splitTarget\)/);
  assert.match(source, /renderPaneRequest\(primaryPaneRequest, \(\) => setPrimaryPaneRequest\(null\)\)/);
  assert.match(source, /primaryPaneRequestRef\.current = primaryPaneRequest/);
  assert.match(source, /const primary = primaryPaneRequestRef\.current[\s\S]*normalizeWorkspacePaneRequest\("primary", modeRef\.current\)/);
});
