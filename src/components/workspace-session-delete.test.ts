// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /const locallyDeletedSessionIdsRef = useRef<Set<string>>\(new Set\(\)\)/,
  "Workspace should keep local delete tombstones beside shared session state",
);

assert.match(
  workspace,
  /const baseSessions = filterDeletedSessions\(\(json\.sessions \?\? \[\]\) as SessionRow\[\], locallyDeletedSessionIdsRef\.current\)/,
  "Workspace should filter every sessions/list response before it reaches shared state",
);

assert.match(
  workspace,
  /const visibleBaseSessions = filterDeletedSessions\(baseSessions, locallyDeletedSessionIdsRef\.current\)[\s\S]*?attachGitHubTaskContext\(visibleBaseSessions, json\)/,
  "GitHub task enrichment should not reintroduce locally deleted sessions",
);

assert.match(
  workspace,
  /if \(!res\.ok \|\| !json\.ok\) \{[\s\S]*?throw new Error\(json\.error \?\? "delete failed"\)/,
  "Workspace delete should fail closed before hiding a row or invalidating cache",
);

assert.match(
  workspace,
  /locallyDeletedSessionIdsRef\.current\.add\(session\.id\)[\s\S]*?setSessions\(\(currentSessions\) => \{[\s\S]*?filterDeletedSessions\(currentSessions, locallyDeletedSessionIdsRef\.current\)/,
  "Workspace should optimistically remove confirmed deletes from shared sessions",
);

assert.match(
  workspace,
  /invalidateConversation\(session\.id\);\s*void loadSessions\(\)/,
  "Workspace should invalidate only after confirmed delete and then refresh in the background",
);

assert.match(
  workspaceSidebar,
  /const \[deleteError, setDeleteError\] = useState<string \| null>\(null\)/,
  "WorkspaceSidebar should retain failed deletes as visible row errors",
);

assert.match(
  workspaceSidebar,
  /catch \(err\) \{[\s\S]*?setDeleteError\(err instanceof Error \? err\.message : "delete failed"\)/,
  "WorkspaceSidebar should surface delete failures instead of clearing the row",
);

console.log("workspace-session-delete.test.ts passed");
