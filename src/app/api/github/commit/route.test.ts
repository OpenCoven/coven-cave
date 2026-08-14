// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "commit route should use the shared installation-agnostic token resolver",
);

assert.match(
  source,
  /const SHA_RE = \/\^\[0-9a-f\]\{7,40\}\$\/i;/,
  "commit sha is validated before path interpolation",
);

assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "commit route should keep the owner/name barrier before path interpolation",
);

assert.match(source, /MAX_FILES/, "file list is capped so giant commits can't flood the card");

assert.doesNotMatch(
  source,
  /:\s*token\b/,
  "commit route must not return token material",
);

// ── PR commit list (?number=, cave-l82dm) ───────────────────────────────────
// The PR reader's Commits tab needs a list, which no endpoint returned. It
// shares this route because it is the same resource under the same repo guard
// and the same auth — a sibling route would duplicate both.

assert.match(
  source,
  /const MAX_COMMITS = 100;/,
  "the commit list is capped to one page rather than paging a runaway branch",
);
assert.match(
  source,
  /truncated: commits\.length >= MAX_COMMITS/,
  "hitting the cap is reported, never silently presented as the whole branch",
);
// The list mode must be dispatched BEFORE the sha guard: a caller passing only
// `number` has no sha, and checking sha first would reject every list request.
assert.match(
  source,
  /if \(number\) return listPullCommits\(repo, number\);\s*\n\s*if \(!SHA_RE\.test\(sha\)\)/,
  "the number branch is dispatched before the sha guard rejects a missing sha",
);
assert.match(
  source,
  /if \(!Number\.isInteger\(number\) \|\| number <= 0\)/,
  "the PR number is validated as a positive integer before path interpolation",
);
// GitHub's verification verdict is the only reliable signature signal here —
// this checkout has no allowed-signers file, so a local %G? check prints E for
// every commit including ones GitHub reports verified.
assert.match(
  source,
  /verified: Boolean\(verification\?\.verified\)/,
  "signature state comes from GitHub's verification field, not a local check",
);

console.log("github-commit-route.test.ts OK");
