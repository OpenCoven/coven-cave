// cave-1poit: the duplicate-id guard for .beads/*.jsonl.
//
// Two jobs here, and the second is the one that matters operationally:
//   1. the detector behaves (fixtures below);
//   2. the repository's REAL .beads/*.jsonl carry no duplicate ids.
//
// (2) is the actual gate. It runs inside `pnpm test:app`, which `Frontend
// build` runs on every PR, and main is protected — so a duplicate cannot reach
// main without a required check going red. That placement is deliberate:
// `git merge` does not invoke the pre-commit hook, and the duplicates this
// guards against were BORN in a merge commit (4f3cb37c11), so a commit-time
// check alone would have missed the causing event entirely.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  beadsJsonlFiles,
  checkFiles,
  findDuplicateIds,
} from "./check-beads-jsonl-duplicates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const rec = (id, extra = "x") => JSON.stringify({ id, kind: "field_change", extra });

test("a clean log reports no duplicates", () => {
  const text = [rec("a"), rec("b"), rec("c")].join("\n") + "\n";
  const { duplicates, malformed, records } = findDuplicateIds(text);
  assert.deepEqual(duplicates, []);
  assert.deepEqual(malformed, []);
  assert.equal(records, 3);
});

test("repeated ids are reported with every line they occupy", () => {
  // The real shape: a block appended twice, non-adjacently — which is what a
  // textual merge of two divergent tails produces.
  const text = [rec("a"), rec("dup1"), rec("dup2"), rec("b"), rec("dup1"), rec("dup2")].join("\n");
  const { duplicates } = findDuplicateIds(text);
  assert.equal(duplicates.length, 2);
  assert.deepEqual(
    duplicates.map((d) => [d.id, d.lines]),
    [
      ["dup1", [2, 5]],
      ["dup2", [3, 6]],
    ],
  );
  assert.ok(duplicates.every((d) => d.identical), "byte-identical copies are flagged as such");
});

test("copies that share an id but differ are flagged as NOT identical", () => {
  // This is the case a script must never resolve on its own: the log
  // disagrees with itself about one event, so first-occurrence-wins would be
  // choosing between two versions of history.
  const text = [rec("a"), rec("a", "DIFFERENT")].join("\n");
  const [dup] = findDuplicateIds(text).duplicates;
  assert.equal(dup.id, "a");
  assert.equal(dup.identical, false, "differing copies must not look safe to auto-drop");
});

test("unparseable lines are reported rather than silently skipped", () => {
  const text = [rec("a"), "{not json", rec("b")].join("\n");
  const { malformed, records } = findDuplicateIds(text);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].line, 2);
  assert.equal(records, 2, "the bad line is not counted as a record");
});

test("blank lines and records without an id do not trip the check", () => {
  // A trailing newline is normal, and at least one real record in this repo's
  // log has no `id` field — neither is a duplicate.
  const text = [rec("a"), "", JSON.stringify({ kind: "rfc", summary: "no id" }), ""].join("\n");
  const { duplicates, malformed } = findDuplicateIds(text);
  assert.deepEqual(duplicates, []);
  assert.deepEqual(malformed, []);
});

test("the repository's own .beads/*.jsonl have no duplicate ids", () => {
  const files = beadsJsonlFiles(repoRoot);
  assert.ok(files.length > 0, "expected at least one .beads/*.jsonl to check");
  for (const result of checkFiles(files)) {
    const rel = result.path.slice(repoRoot.length + 1);
    assert.deepEqual(
      result.malformed,
      [],
      `${rel} has unparseable lines: ${JSON.stringify(result.malformed.slice(0, 3))}`,
    );
    assert.deepEqual(
      result.duplicates.map((d) => `${d.id} @ ${d.lines.join(",")}`),
      [],
      `${rel} carries duplicate record ids — see cave-1poit`,
    );
  }
});

test("the guard is reachable as a CLI, not only as a module", () => {
  // A checker nothing invokes is not a guard. Keep the package script and the
  // executable entry point pinned together.
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["check:beads-jsonl"],
    "node scripts/check-beads-jsonl-duplicates.mjs",
    "package.json must expose the guard as a runnable script",
  );
  const source = readFileSync(join(repoRoot, "scripts/check-beads-jsonl-duplicates.mjs"), "utf8");
  assert.match(source, /import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/, "has a CLI entry");
});
