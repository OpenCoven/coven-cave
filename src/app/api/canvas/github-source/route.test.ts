// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const importRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const projectRoute = readFileSync(new URL("../project-file/route.ts", import.meta.url), "utf8");

assert.match(
  importRoute,
  /requireTrustedHumanCanvasMutation\(req\)/,
  "GitHub imports require a trusted human Canvas mutation",
);
assert.match(
  importRoute,
  /https:\/\/api\.github\.com\/repos\/\$\{encodeURIComponent\(parsed\.owner\)\}/,
  "the importer fetches only the fixed GitHub API host with encoded path segments",
);
assert.match(
  importRoute,
  /MAX_ARTIFACT_CODE_CHARS/,
  "remote source is bounded by the Canvas artifact limit",
);
assert.match(
  importRoute,
  /projectFileHash: createHash\("sha256"\)\.update\(code\)\.digest\("hex"\)/,
  "the importer persists an exact content baseline for safe project replacement",
);
assert.match(
  projectRoute,
  /artifact = canvas\.artifacts\.find/,
  "the project write target comes from persisted artifact provenance",
);
assert.doesNotMatch(
  projectRoute,
  /body\.(?:filePath|projectId|projectRoot)/,
  "clients cannot choose the project or destination path during a write",
);
assert.match(
  projectRoute,
  /const realParent = await realpath\(parent\)/,
  "the destination parent is realpath-checked before writing",
);
assert.match(
  projectRoute,
  /targetStat\.isSymbolicLink\(\)/,
  "an existing destination symlink is rejected before writing",
);
assert.match(
  projectRoute,
  /\["--literal-pathspecs", "status", "--porcelain", "--", freshSource\.filePath\]/,
  "the project writer refuses to overwrite an already-dirty source file",
);
assert.match(
  projectRoute,
  /function replaceAtomically[\s\S]{0,500}?writeFile\(tempPath[\s\S]{0,500}?rename\(tempPath, target\)/,
  "project writes replace the destination atomically instead of following it",
);
assert.match(
  projectRoute,
  /targetMode = targetStat\.mode & 0o777[\s\S]{0,1200}?replaceAtomically\([\s\S]{0,120}?targetMode/,
  "atomic replacement preserves an existing project file's permissions",
);
assert.match(
  projectRoute,
  /withRepositoryMutation\(root[\s\S]{0,1200}?freshArtifact\.updatedAt !== expectedUpdatedAt/,
  "repository mutation serialization revalidates the exact artifact revision",
);
assert.match(
  projectRoute,
  /writeFile\(tempPath[\s\S]{0,500}?readStableProjectFile\([\s\S]{0,300}?await rename\(tempPath, target\)/,
  "the imported baseline is behaviorally rechecked after preparation and immediately before replacement",
);
assert.match(
  projectRoute,
  /upsertCanvasArtifact\(updatedArtifact,[\s\S]{0,900}?replaceAtomically\(target, stableRead\.originalCode, targetMode\)/,
  "the applied baseline is persisted and a failed metadata save rolls the project file back",
);

console.log("canvas GitHub route contracts: ok");
