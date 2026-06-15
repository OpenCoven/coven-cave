// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /function gitDiff[\s\S]*\["diff", "--no-ext-diff", "--no-textconv", \.\.\.args\]/,
  "git diff calls must disable external diff helpers and textconv filters",
);

assert.doesNotMatch(
  source,
  /git\(repoRoot, \["diff"/,
  "changes route should use gitDiff for every git diff invocation",
);

console.log("changes route.test.ts: ok");
