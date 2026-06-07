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
const libraryGitHubList = await source("components/library-github-list.tsx");
const boardInspector = await source("components/board-inspector.tsx");
const githubTasks = await source("lib/github-tasks.ts");

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
assert.match(
  boardStore,
  /const github = mergeGitHubLinks\(normalizeGitHubLinks\(c\.github\), \.\.\.gitHubLinksFromLinks\(c\.links\)\)/,
  "Board backfill should preserve explicit GitHub connections and derive legacy GitHub link URLs",
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
  libraryGitHubList,
  /libraryItemToTaskGitHubLink\(item\)/,
  "GitHub Add-in attach flow should convert saved items into the task GitHub field",
);
assert.match(
  libraryGitHubList,
  /github: mergeTaskGitHubLinks\(existing\.github[\s\S]*?libraryItemToTaskGitHubLink\(item\)/,
  "GitHub Add-in existing-task attach should merge task GitHub connections",
);
assert.doesNotMatch(
  libraryGitHubList,
  /links: \[item\.url\]/,
  "GitHub Add-in attach should not replace existing task links with a single URL",
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

console.log("github task field guard passed");
