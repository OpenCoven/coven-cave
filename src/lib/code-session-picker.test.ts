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

function queue(groups) {
  return {
    groups,
    sessions: groups.flatMap((group) => group.sessions),
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
assert.equal(
  codeSessionMatchesQuery(
    row({ git: { repositoryUrl: "https://github.com/acme/coven-cave" } }),
    "acme/coven-cave",
  ),
  true,
);
assert.equal(codeSessionMatchesQuery(row({ workBranch: "feat/cave-8i8q5-x-api" }), "8i8q5"), true);
assert.equal(codeSessionMatchesQuery(row(), "nothing-here"), false);

// The project label is matched, not the whole absolute path — otherwise every
// session matches "Users".
assert.equal(codeSessionMatchesQuery(row(), "/Users/x/code"), false);

// Reviewable groups show canonical owner/repo labels, so the same slug must be
// searchable even when multiple local checkouts share one basename.
{
  const rows = [
    row({
      id: "acme",
      project_root: "/Users/x/worktrees/coven-cave",
      git: { repositoryUrl: "https://github.com/acme/coven-cave" },
    }),
    row({
      id: "other",
      title: "Other fork",
      project_root: "/Users/x/sandboxes/coven-cave",
      git: { repositoryUrl: "https://github.com/other/coven-cave" },
    }),
  ];
  const sharedBasename = queue([
    {
      key: "https://github.com/acme/coven-cave",
      label: "acme/coven-cave",
      sessions: [rows[0]],
    },
    {
      key: "https://github.com/other/coven-cave",
      label: "other/coven-cave",
      sessions: [rows[1]],
    },
  ]);

  const slugMatch = codeSessionPickerResult(sharedBasename, "other/coven-cave", null);
  assert.equal(slugMatch.offersCreate, false);
  assert.equal(slugMatch.count, 1);
  assert.deepEqual(slugMatch.groups.map((group) => group.label), ["other/coven-cave"]);
  assert.deepEqual(slugMatch.groups[0].sessions.map((session) => session.id), ["other"]);

  const basenameMatch = codeSessionPickerResult(sharedBasename, "coven-cave", null);
  assert.equal(basenameMatch.offersCreate, false);
  assert.equal(basenameMatch.count, 2);
  assert.deepEqual(basenameMatch.groups.map((group) => group.label), ["acme/coven-cave", "other/coven-cave"]);
}

// ── Grouping ─────────────────────────────────────────────────────────────────

{
  const rows = [
    row({ id: "a", updated_at: "2026-08-08T09:00:00.000Z" }),
    row({ id: "b", updated_at: "2026-08-08T11:00:00.000Z" }),
    row({ id: "c", project_root: "/Users/x/code/coven-pocket", updated_at: "2026-08-08T12:00:00.000Z" }),
  ];
  const result = codeSessionPickerResult(
    queue([
      {
        key: "repo-pocket",
        label: "acme/coven-pocket",
        sessions: [rows[2]],
      },
      {
        key: "repo-cave",
        label: "acme/coven-cave",
        sessions: [rows[1], rows[0]],
      },
    ]),
    "",
    null,
  );
  assert.equal(result.groups.length, 2);
  // The picker inherits the queue's group and session order verbatim.
  assert.equal(result.groups[0].label, "acme/coven-pocket");
  assert.equal(result.groups[1].label, "acme/coven-cave");
  assert.deepEqual(result.groups[1].sessions.map((s) => s.id), ["b", "a"]);
  assert.deepEqual(result.groups.flatMap((group) => group.sessions).map((s) => s.id), ["c", "b", "a"]);
  assert.equal(result.count, 3);
  assert.equal(result.offersCreate, false);
}

// The picker does not re-decide queue eligibility. Whatever ordering and
// visibility CodeView already computed is the source of truth here.
{
  const rows = [
    row({ id: "running", workBranch: "feat/reviewable-first" }),
    row({ id: "fallback", workBranch: "chore/elsewhere" }),
    row({ id: "tail", workBranch: "feat/reviewable-first-tail" }),
  ];
  const result = codeSessionPickerResult(
    queue([
      {
        key: "repo-a",
        label: "acme/repo-a",
        sessions: [rows[0], rows[2]],
      },
      {
        key: "repo-b",
        label: "acme/repo-b",
        sessions: [rows[1]],
      },
    ]),
    "reviewable-first",
    null,
  );
  assert.deepEqual(result.groups.flatMap((group) => group.sessions).map((s) => s.id), ["running", "tail"]);
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
  const sharedQueue = queue([
    {
      key: "repo-cave",
      label: "acme/coven-cave",
      sessions: [rows[1], rows[0]],
    },
    {
      key: "repo-pocket",
      label: "acme/coven-pocket",
      sessions: [rows[2]],
    },
  ]);
  const all = codeSessionPickerResult(sharedQueue, "", null);
  const scoped = codeSessionPickerResult(sharedQueue, "", "repo-pocket");
  assert.deepEqual(
    all.chips.map((c) => [c.label, c.count]),
    scoped.chips.map((c) => [c.label, c.count]),
  );
  // "All" leads, then queue order.
  assert.equal(all.chips[0].key, null);
  assert.deepEqual(all.chips.map((c) => c.label), ["All", "acme/coven-cave", "acme/coven-pocket"]);
  // The scope filter narrows the groups even though the chips held still.
  assert.equal(scoped.groups.length, 1);
  assert.equal(scoped.groups[0].label, "acme/coven-pocket");
  assert.deepEqual(scoped.groups[0].sessions.map((session) => session.id), ["c"]);
  assert.equal(scoped.count, 1);
}

// ── Empty states ─────────────────────────────────────────────────────────────

// A miss on a typed query offers to become a session; an empty workspace does
// not — there is no name to create it under.
assert.equal(
  codeSessionPickerResult(
    queue([{ key: "repo-cave", label: "acme/coven-cave", sessions: [row()] }]),
    "zzz",
    null,
  ).offersCreate,
  true,
);
assert.equal(codeSessionPickerResult(queue([]), "", null).offersCreate, false);
assert.equal(codeSessionPickerResult(queue([]), "", null).count, 0);

console.log("code-session-picker: ok");
