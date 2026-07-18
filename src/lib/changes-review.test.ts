// @ts-nocheck
import assert from "node:assert/strict";
import { buildChangesReviewPrompt, REVIEW_FILE_LIST_CAP } from "./changes-review.ts";

const files = [
  { path: "src/a.ts", status: "modified", insertions: 12, deletions: 3 },
  { path: "src/b.ts", status: "added", insertions: 40, deletions: 0 },
  { path: "docs/x.md", status: "deleted", insertions: 0, deletions: 18 },
  { path: "src/new-name.ts", status: "renamed", renamedFrom: "src/old-name.ts" },
  { path: "notes.txt", status: "untracked" },
];

const prompt = buildChangesReviewPrompt({ repoRoot: "/repo/root", files });

// Anchors: repo root, count, and every file with its status.
assert.match(prompt, /uncommitted changes in \/repo\/root/, "prompt names the repo root");
assert.match(prompt, /Changed files \(5\):/, "prompt carries the file count");
assert.match(prompt, /- src\/a\.ts — modified \(\+12\/−3\)/, "modified file lists ± counts");
assert.match(prompt, /- src\/new-name\.ts — renamed \(from src\/old-name\.ts\)/, "renames name their origin");
assert.match(prompt, /- notes\.txt — untracked/, "untracked files are listed");

// The agent must read real patches, not judge from the inventory.
assert.match(prompt, /git diff/, "prompt instructs reading the actual diff");
assert.match(prompt, /git diff --staged/, "staged changes are covered");
assert.match(prompt, /untracked files must be read directly/, "untracked handling is spelled out");

// Review structure: verdict first, then bugs/security/tests/nits.
assert.match(
  prompt,
  /1\. \*\*Verdict\*\*[\s\S]*2\. \*\*Bugs & correctness risks\*\*[\s\S]*3\. \*\*Security & data-loss concerns\*\*[\s\S]*4\. \*\*Test gaps\*\*[\s\S]*5\. \*\*Nits\*\*/,
  "review sections arrive in verdict-first order",
);

// Cap: a huge working tree lists the first N files and says how many were cut.
const many = Array.from({ length: REVIEW_FILE_LIST_CAP + 25 }, (_, i) => ({
  path: `src/f${i}.ts`,
  status: "modified",
}));
const capped = buildChangesReviewPrompt({ repoRoot: "/r", files: many });
assert.match(capped, new RegExp(`Changed files \\(${REVIEW_FILE_LIST_CAP + 25}\\):`), "count reflects ALL files");
assert.match(capped, /…and 25 more \(run git status for the full list\)\./, "omitted files are counted honestly");
assert.ok(!capped.includes(`src/f${REVIEW_FILE_LIST_CAP}.ts`), "files past the cap are not listed");
assert.ok(capped.includes(`src/f${REVIEW_FILE_LIST_CAP - 1}.ts`), "files inside the cap are listed");

console.log("changes-review.test.ts: ok");
