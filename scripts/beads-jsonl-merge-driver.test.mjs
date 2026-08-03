// cave-1poit: the .beads/interactions.jsonl merge driver.
//
// The unit tests below cover the union logic, but the test that matters is the
// integration one: it builds a real git repository, reproduces the exact
// divergence that duplicated records on main, and merges it BOTH ways — once
// with `merge=union` (the setting being replaced) and once with this driver.
// A source-text or unit-only test could not show that union is the cause.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { unionByRecordId } from "./beads-jsonl-merge-driver.mjs";

const driver = fileURLToPath(new URL("./beads-jsonl-merge-driver.mjs", import.meta.url));

const rec = (id, extra = "x") => JSON.stringify({ id, kind: "field_change", extra });

// ---------------------------------------------------------------- unit ----

test("records unique to either side are all kept, exactly once", () => {
  const ours = [rec("a"), rec("b")];
  const theirs = [rec("a"), rec("c")];
  const { lines } = unionByRecordId(ours, theirs);
  assert.deepEqual(lines, [rec("a"), rec("b"), rec("c")]);
});

test("ours keeps its order and theirs is appended", () => {
  const { lines, fromTheirs } = unionByRecordId([rec("b"), rec("a")], [rec("c")]);
  assert.deepEqual(lines, [rec("b"), rec("a"), rec("c")]);
  assert.equal(fromTheirs, 1);
});

test("a duplicate already present within one side is collapsed too", () => {
  // main reached 20 duplicates by carrying them WITHIN one side, so the driver
  // must not merely avoid adding new ones — it has to be idempotent.
  const { lines, droppedDuplicates } = unionByRecordId([rec("a"), rec("a"), rec("b")], []);
  assert.deepEqual(lines, [rec("a"), rec("b")]);
  assert.equal(droppedDuplicates, 1);
});

test("same id with different content keeps the first and drops the second", () => {
  // Safe only because interaction records are immutable: one id denotes one
  // event. This is why issues.jsonl is NOT routed through this driver.
  const { lines } = unionByRecordId([rec("a", "first")], [rec("a", "second")]);
  assert.deepEqual(lines, [rec("a", "first")]);
});

test("unkeyable lines survive, deduplicated by exact text", () => {
  // Losing a line silently is worse than carrying an odd one, in an audit log.
  const noId = JSON.stringify({ kind: "rfc", summary: "no id" });
  const malformed = "{not json";
  const { lines } = unionByRecordId([noId, malformed], [noId, malformed, rec("a")]);
  assert.deepEqual(lines, [noId, malformed, rec("a")]);
});

test("a missing side contributes nothing rather than throwing", () => {
  const { lines } = unionByRecordId([rec("a")], []);
  assert.deepEqual(lines, [rec("a")]);
});

// --------------------------------------------------------- integration ----

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e",
           GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
  });
}

/**
 * Build the divergence that produced the real duplicates.
 *
 * The shared block must land at DIFFERENT OFFSETS on the two sides, which is
 * the shape main actually had — the same 6 records at lines 975-980 and again
 * at 997-1002. If both sides append it identically at the same position, git
 * recognises one addition and union does not duplicate; that is why an
 * obvious-looking reproduction shows nothing. Here `ours` writes its own
 * record BEFORE the shared block and `theirs` writes its own AFTER, so the
 * added hunks overlap without matching.
 */
function buildDivergedRepo(mergeAttribute, prefix = "beads-merge-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, ".beads"), { recursive: true });
  const log = join(dir, ".beads", "interactions.jsonl");

  const base = [rec("r1"), rec("r2")];
  writeFileSync(log, base.join("\n") + "\n");
  writeFileSync(join(dir, ".gitattributes"), `.beads/interactions.jsonl ${mergeAttribute}\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");

  const shared = [rec("s1"), rec("s2"), rec("s3")];

  git(dir, "checkout", "-qb", "other");
  writeFileSync(log, [...base, ...shared, rec("theirs")].join("\n") + "\n");
  git(dir, "commit", "-qam", "other: shared block, then its own record");

  git(dir, "checkout", "-q", "main");
  writeFileSync(log, [...base, rec("ours"), ...shared].join("\n") + "\n");
  git(dir, "commit", "-qam", "main: its own record, then the same shared block");

  return { dir, log };
}

function idCounts(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const ids = lines.map((l) => JSON.parse(l).id);
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { lines: lines.length, ids, counts };
}

test("merge=union DUPLICATES the shared block — the bug being fixed", () => {
  const { dir, log } = buildDivergedRepo("merge=union");
  try {
    git(dir, "merge", "-q", "--no-edit", "other");
    const { counts } = idCounts(log);
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    assert.deepEqual(
      duplicated.sort(),
      ["s1", "s2", "s3"],
      "union concatenates both sides, so the shared block lands twice",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the driver merges the same divergence with NO duplicates and NO loss", () => {
  const { dir, log } = buildDivergedRepo("merge=beads-jsonl");
  try {
    git(dir, "config", "merge.beads-jsonl.name", "test");
    git(dir, "config", "merge.beads-jsonl.driver", `node "${driver}" "%O" "%A" "%B"`);
    git(dir, "merge", "-q", "--no-edit", "other");

    const { counts, ids } = idCounts(log);
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(duplicated, [], "no id may appear twice after a merge");

    // Nothing lost: every record from either branch is present.
    for (const id of ["r1", "r2", "s1", "s2", "s3", "ours", "theirs"]) {
      assert.ok(ids.includes(id), `record ${id} must survive the merge`);
    }
    assert.equal(ids.length, 7, "exactly the union, nothing invented");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without registration git falls back to a LOUD conflict, not silent duplication", () => {
  // The failure direction matters: the driver cannot be committed (it lives in
  // git config), so an unregistered clone must not quietly reintroduce the bug.
  const { dir, log } = buildDivergedRepo("merge=beads-jsonl");
  try {
    let conflicted = false;
    try {
      git(dir, "merge", "-q", "--no-edit", "other");
    } catch {
      conflicted = true;
    }
    const text = readFileSync(log, "utf8");
    assert.ok(
      conflicted || text.includes("<<<<<<<"),
      "an unregistered driver must conflict rather than merge silently",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
