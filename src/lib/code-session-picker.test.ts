// @ts-nocheck
import assert from "node:assert/strict";

const { codeSessionMatchesQuery, codeSessionPickerResult } = await import("./code-session-picker.ts");

function row(over = {}) {
  return {
    id: "s1",
    title: "Loopback port after daemon restart",
    project_root: "/Users/x/code/coven-cave",
    updated_at: "2026-08-08T10:00:00.000Z",
    status: "idle",
    ...over,
  };
}

// ── Filtering ────────────────────────────────────────────────────────────────

// A blank query is not a filter — it must not hide anything.
assert.equal(codeSessionMatchesQuery(row(), "   "), true);

// Title, project label and branch are all searchable, case-insensitively. The
// branch case is the one that matters: coding sessions get remembered by branch
// at least as often as by name.
assert.equal(codeSessionMatchesQuery(row(), "LOOPBACK"), true);
assert.equal(codeSessionMatchesQuery(row(), "coven-cave"), true);
assert.equal(codeSessionMatchesQuery(row({ workBranch: "feat/cave-8i8q5-x-api" }), "8i8q5"), true);
assert.equal(codeSessionMatchesQuery(row(), "nothing-here"), false);

// The project label is matched, not the whole absolute path — otherwise every
// session matches "Users".
assert.equal(codeSessionMatchesQuery(row(), "/Users/x/code"), false);

// ── Grouping ─────────────────────────────────────────────────────────────────

{
  const rows = [
    row({ id: "a", updated_at: "2026-08-08T09:00:00.000Z" }),
    row({ id: "b", updated_at: "2026-08-08T11:00:00.000Z" }),
    row({ id: "c", project_root: "/Users/x/code/coven-pocket", updated_at: "2026-08-08T12:00:00.000Z" }),
  ];
  const result = codeSessionPickerResult(rows, "", null);
  assert.equal(result.groups.length, 2);
  // Newest group first, newest session first inside it.
  assert.equal(result.groups[0].label, "coven-pocket");
  assert.equal(result.groups[1].label, "coven-cave");
  assert.deepEqual(result.groups[1].sessions.map((s) => s.id), ["b", "a"]);
  assert.equal(result.count, 3);
  assert.equal(result.offersCreate, false);
}

// Archived and generated sessions never reach the picker — the rail's own
// visibility rule, reused so the two lenses cannot drift apart.
{
  const rows = [row({ id: "keep" }), row({ id: "gone", archived_at: "2026-08-01T00:00:00.000Z" }), row({ id: "gen", generated: true })];
  const result = codeSessionPickerResult(rows, "", null);
  assert.deepEqual(result.groups[0].sessions.map((s) => s.id), ["keep"]);
}

// A session with no project root lands in a trailing "(unknown)" group rather
// than being dropped: a session you cannot find is worse than an ugly label.
{
  const rows = [row({ id: "orphan", project_root: "" }), row({ id: "normal" })];
  const result = codeSessionPickerResult(rows, "", null);
  assert.equal(result.groups.at(-1).label, "(unknown)");
  assert.equal(result.count, 2);
}

// ── Chips ────────────────────────────────────────────────────────────────────

// Chip counts ignore the project filter, so clicking a chip never changes the
// numbers beside it — a count that moved when you selected it would read as the
// filter having deleted work.
{
  const rows = [
    row({ id: "a" }),
    row({ id: "b" }),
    row({ id: "c", project_root: "/Users/x/code/coven-pocket" }),
  ];
  const all = codeSessionPickerResult(rows, "", null);
  const scoped = codeSessionPickerResult(rows, "", "/Users/x/code/coven-pocket");
  assert.deepEqual(
    all.chips.map((c) => [c.label, c.count]),
    scoped.chips.map((c) => [c.label, c.count]),
  );
  // "All" leads, then projects by size.
  assert.equal(all.chips[0].root, null);
  assert.deepEqual(all.chips.map((c) => c.label), ["All", "coven-cave", "coven-pocket"]);
  // The project filter narrows the groups even though the chips held still.
  assert.equal(scoped.groups.length, 1);
  assert.equal(scoped.count, 1);
}

// ── Empty states ─────────────────────────────────────────────────────────────

// A miss on a typed query offers to become a session; an empty workspace does
// not — there is no name to create it under.
assert.equal(codeSessionPickerResult([row()], "zzz", null).offersCreate, true);
assert.equal(codeSessionPickerResult([], "", null).offersCreate, false);
assert.equal(codeSessionPickerResult([], "", null).count, 0);

console.log("code-session-picker: ok");
