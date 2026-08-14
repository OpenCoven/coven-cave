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
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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

test("copies differing only by whitespace are NOT called identical", () => {
  // `identical` claims byte-identity and is the signal that a copy is safe to
  // drop. Comparing trimmed text would overstate that: these two lines encode
  // the same record but are not the same bytes, so a human should look.
  const text = [rec("a"), "  " + rec("a")].join("\n");
  const [dup] = findDuplicateIds(text).duplicates;
  assert.equal(dup.id, "a");
  assert.equal(dup.identical, false, "whitespace-only differences must not read as byte-identical");
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

test("the guard actually RUNS as a CLI and exits non-zero on duplicates", () => {
  // Deliberately executes the script instead of matching its source. A
  // source-text pin cannot tell a working CLI entry from a broken one: the
  // original spelling (`file://${process.argv[1]}`) matched the pattern and
  // worked on a plain POSIX path, yet would silently no-op under a checkout
  // path containing a space, because it does not percent-encode. A checker
  // that quietly does nothing is the worst failure mode here, so prove it
  // runs.
  const script = join(repoRoot, "scripts/check-beads-jsonl-duplicates.mjs");

  const dir = mkdtempSync(join(tmpdir(), "beads-dup-guard-"));
  const clean = join(dir, "clean.jsonl");
  const dirty = join(dir, "dirty.jsonl");
  writeFileSync(clean, [rec("a"), rec("b")].join("\n") + "\n");
  writeFileSync(dirty, [rec("a"), rec("b"), rec("a")].join("\n") + "\n");

  const run = (file) => spawnSync(process.execPath, [script, file], { encoding: "utf8" });

  const ok = run(clean);
  assert.equal(ok.status, 0, `clean file should exit 0, got ${ok.status}\n${ok.stderr}`);
  assert.match(ok.stdout, /no duplicate ids/, "and say so on stdout");

  const bad = run(dirty);
  assert.equal(bad.status, 1, "a duplicated id must exit non-zero or nothing gates on it");
  assert.match(bad.stderr, /1 duplicated id/, "and name the problem on stderr");
  assert.match(bad.stderr, /cave-1poit/, "pointing at the bead that explains the cause");

  rmSync(dir, { recursive: true, force: true });
});

test("a checkout path containing a space still runs the CLI", () => {
  // The concrete regression the percent-encoding fix addresses: copy the
  // script under a directory with a space and confirm it still executes.
  const dir = mkdtempSync(join(tmpdir(), "beads dup guard "));
  const script = join(dir, "check.mjs");
  copyFileSync(join(repoRoot, "scripts/check-beads-jsonl-duplicates.mjs"), script);
  const dirty = join(dir, "dirty.jsonl");
  writeFileSync(dirty, [rec("a"), rec("a")].join("\n") + "\n");

  const res = spawnSync(process.execPath, [script, dirty], { encoding: "utf8" });
  assert.equal(
    res.status,
    1,
    `CLI must still run from a path with a space (got ${res.status}); ` +
      "a naive file:// concatenation silently no-ops here",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("the guard is exposed as a package script", () => {
  // A checker nothing invokes is not a guard.
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["check:beads-jsonl"],
    "node scripts/check-beads-jsonl-duplicates.mjs",
    "package.json must expose the guard as a runnable script",
  );
});
