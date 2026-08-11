import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const boardTypes = await source("lib/cave-board-types.ts");
const boardStore = await source("lib/cave-board.ts");
const boardCreateApi = await source("app/api/board/route.ts");
const boardPatchApi = await source("app/api/board/[id]/route.ts");
const boardInspector = await source("components/board-inspector.tsx");
const githubTasks = await source("lib/github-tasks.ts");
const taskGithub = await source("lib/task-github.ts");

assert.match(
  boardTypes,
  /export type CardGitHubLink = \{/,
  "Task cards should expose a structured GitHub connection field",
);
assert.match(
  boardTypes,
  /github: CardGitHubLink\[\]/,
  "Task cards should persist structured GitHub connections",
);
assert.match(
  boardStore,
  /normalizeGitHubLinks/,
  "Board persistence should normalize task GitHub connections",
);
// Asserted as separate facts rather than one literal expression: the call is
// now multi-line, and pinning its exact text made this break on a change that
// preserved every behaviour it names (cave-0b8t8).
assert.match(
  boardStore,
  /const storedGitHub = normalizeGitHubLinks\(c\.github\)/,
  "Board backfill normalizes the stored GitHub connections",
);
assert.match(
  boardStore,
  /mergeGitHubLinks\(\s*storedGitHub,/,
  "Board backfill preserves explicit GitHub connections as the merge base",
);
assert.match(
  boardStore,
  /gitHubLinksFromLinks\(c\.links\)\.filter\(/,
  "Board backfill still derives legacy GitHub link URLs",
);
assert.match(
  boardStore,
  /sameGitHubTarget\(stored, derived\)/,
  "a URL-derived GitHub link is dropped when a stored link already names that item — otherwise its generated title overwrites the real one on every load (cave-0b8t8)",
);
assert.match(
  boardCreateApi,
  /github\?: CardGitHubLink\[\]/,
  "Create task API should accept structured GitHub connections",
);
assert.match(
  boardPatchApi,
  /github: CardGitHubLink\[\]/,
  "Patch task API should accept structured GitHub connections",
);
assert.match(
  boardInspector,
  /taskGitHubLinkFromAssignedItem\(item\)/,
  "Task inspector GitHub attach should store assigned GitHub items in the task GitHub field",
);
assert.match(
  boardInspector,
  /const github = mergeTaskGitHubLinks\(card\.github[\s\S]*?taskGitHubLinkFromAssignedItem\(item\)/,
  "Task inspector GitHub attach should merge structured GitHub connections",
);
assert.match(
  githubTasks,
  /github: \[taskGitHubLinkFromGitHubItem\(item\)\]/,
  "GitHub activity actions that create tasks should seed the task GitHub field",
);
assert.match(
  githubTasks,
  /const github = githubLink\s*\?\s*mergeTaskGitHubLinks\(\s*existingGitHub,[\s\S]*?taskGitHubLinkFromGitHubItem\(item\)/,
  "GitHub activity actions that attach to tasks should merge structured GitHub connections",
);
assert.doesNotMatch(
  taskGithub,
  /libraryItemToTaskGitHubLink|LibraryGitHubItem|@\/lib\/library-types/,
  "shared task GitHub helpers should not depend on the feature-branch Library",
);

console.log("github task field guard passed");
