// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./project/search/route.ts", import.meta.url), "utf8");

// Every glob handed to ripgrep must be a hardcoded exclusion literal. A
// user-controlled or include glob can widen the search into hidden/ignored
// files and expose secret-bearing lines in previews.
const globPushes = [...route.matchAll(/"--glob",\s*([^),]+)/g)];
for (const [, value] of globPushes) {
  assert.match(
    value.trim(),
    /^"!/,
    `ripgrep glob argument ${value.trim()} must be a hardcoded exclusion literal ("!...") — never user-controlled and never an include glob`,
  );
}
assert.match(
  route,
  /"--glob",\s*"!\.env\*",\s*"--glob",\s*"!\*\*\/\.env\*"/,
  "project search must keep the hardcoded .env-family exclusion globs that mirror /api/project-file's redaction boundary",
);
assert.match(
  route,
  /filterSearchResult\(parseRipgrepJson\(stdout\), glob\)/,
  "project search should preserve the glob filter by applying it after ripgrep has already honored hidden and ignore defaults",
);
assert.match(
  route,
  /explicit include globs can widen the\s+\/\/ search to hidden or ignored files/,
  "route should document why glob filtering cannot be delegated to ripgrep",
);

console.log("project-search-security.test.ts: ok");
