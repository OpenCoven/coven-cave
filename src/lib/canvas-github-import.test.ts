import assert from "node:assert/strict";

import type { CaveProject } from "./cave-projects-types.ts";
import {
  CREATE_CANVAS_IMPORT_PROJECT,
  canvasGitHubImportFileName,
  canvasImportProjectGroups,
  defaultCanvasImportProjectChoice,
  isSupportedCanvasGitHubFile,
} from "./canvas-github-import.ts";
import type { GitHubFileLocation } from "./github-repo-link.ts";

const source: GitHubFileLocation = {
  owner: "OpenCoven",
  repo: "coven-cave",
  ref: "main",
  filePath: "src/App.tsx",
  repoUrl: "https://github.com/OpenCoven/coven-cave",
  sourceUrl: "https://github.com/OpenCoven/coven-cave/blob/main/src/App.tsx",
};

const project = (id: string, name: string, repoUrl?: string): CaveProject => ({
  id,
  name,
  root: `/projects/${id}`,
  ...(repoUrl ? { repoUrl } : {}),
  createdAt: "2026-08-24T10:00:00.000Z",
  updatedAt: "2026-08-24T10:00:00.000Z",
});

for (const filePath of ["page.html", "page.htm", "src/App.jsx", "src/App.tsx"]) {
  assert.equal(isSupportedCanvasGitHubFile(filePath), true, `${filePath} is supported`);
}
for (const filePath of ["README.md", "src/App.ts"]) {
  assert.equal(isSupportedCanvasGitHubFile(filePath), false, `${filePath} is unsupported`);
}

const exactSecond = project("exact-second", "Zulu", "https://github.com/opencoven/COVEN-CAVE");
const unlinkedSecond = project("unlinked-second", "Yellow");
const exactFirst = project("exact-first", "Alpha", "OpenCoven/coven-cave");
const unlinkedFirst = project("unlinked-first", "Beta");
const groups = canvasImportProjectGroups(
  [
    exactSecond,
    unlinkedSecond,
    project("other", "Other", "https://github.com/OpenCoven/another-repo"),
    project("malformed", "Malformed", "not a repository"),
    exactFirst,
    unlinkedFirst,
  ],
  source,
);

assert.deepEqual(
  groups,
  {
    linked: [exactFirst, exactSecond],
    unlinked: [unlinkedFirst, unlinkedSecond],
  },
  "projects are alphabetized into exact repository-linked and unlinked groups",
);
assert.equal(
  defaultCanvasImportProjectChoice([exactSecond, exactFirst], source),
  "exact-first",
  "the first alphabetized exact linked project is selected",
);
assert.equal(
  defaultCanvasImportProjectChoice([unlinkedFirst], source),
  CREATE_CANVAS_IMPORT_PROJECT,
  "creating a project is selected when no exact linked project exists",
);
assert.equal(canvasGitHubImportFileName(source), "App.tsx");

console.log("canvas GitHub import rules: ok");
