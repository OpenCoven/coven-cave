import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(
  "src/components/canvas-github-import-modal.tsx",
  "utf8",
);

assert.match(
  modal,
  /breadcrumb=\{\["Canvas", "Import GitHub file"\]\}/,
  "the dialog truthfully names the single-file operation",
);
assert.match(
  modal,
  /You’ll review it in Canvas before saving\./,
  "the intro explains that loading is not the final Canvas save",
);
assert.match(
  modal,
  /isSupportedCanvasGitHubFile\(parsed\.filePath\)/,
  "unsupported extensions are rejected before submission",
);
assert.match(
  modal,
  /canvasImportProjectGroups\(projects, parsed\)/,
  "the project list is limited to linked or linkable projects",
);
assert.match(
  modal,
  /defaultCanvasImportProjectChoice\(projects, parsed\)/,
  "a repository-linked project is selected automatically",
);
assert.match(
  modal,
  /createProjectOrThrow\(\s*parsed\.repo,\s*projectRoot\.trim\(\),\s*\{ repoUrl: parsed\.repoUrl \},\s*\)/,
  "new projects derive their name from the repository and require only a root",
);
assert.match(
  modal,
  /shell_pick_directory/,
  "the desktop path uses the native folder dialog",
);
assert.match(
  modal,
  /Canvas doesn’t clone repositories\./,
  "the local-checkout requirement is explicit",
);
assert.match(
  modal,
  /\{busy \? "Loading…" : `Load \$\{fileName\}`\}/,
  "the primary action describes the actual next step",
);
assert.match(
  modal,
  /aria-invalid=\{Boolean\(sourceError\) \|\| undefined\}/,
  "URL validation is exposed to assistive technology",
);
assert.match(
  modal,
  /\{error \? \(\s*<ProjectRootWorkspaceNotice[\s\S]*className="canvas-github-import__error"/,
  "submission failures render inline through the shared workspace notice",
);
assert.match(
  modal,
  /ProjectRootWorkspaceNotice[\s\S]*errorCode[\s\S]*error=\{error\}/,
  "the modal threads the server failure code so the notice can render the containment error inline",
);
assert.doesNotMatch(
  modal,
  /Sketch branch|Pull request/,
  "the modal does not promise workflow steps it does not perform",
);
assert.doesNotMatch(
  modal,
  />Project name</,
  "repository registration does not ask for a redundant project name",
);

console.log("canvas GitHub import modal contract: ok");
