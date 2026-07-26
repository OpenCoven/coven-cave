// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COVEN_GITHUB_SUBSCRIPTIONS_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gh-subs-test-")),
  "github-subscriptions.json",
);

const {
  diffCompletedRuns,
  diffOpenedPrs,
  isValidRepo,
  loadSubscriptions,
  patchSubscriptions,
  updateCursor,
  SEEN_RUN_IDS_CAP,
} = await import("./github-subscriptions.ts");

// ── repo validation ──────────────────────────────────────────────────────────
assert.equal(isValidRepo("OpenCoven/coven-cave"), true, "owner/name valid");
assert.equal(isValidRepo("a/b.c-d_e"), true, "dots/dashes/underscores in name");
assert.equal(isValidRepo("no-slash"), false, "missing slash rejected");
assert.equal(isValidRepo("owner/name/extra"), false, "extra segment rejected");
assert.equal(isValidRepo("-bad/name"), false, "leading dash owner rejected");
assert.equal(isValidRepo(""), false, "empty rejected");

// ── store defaults + patching ────────────────────────────────────────────────
{
  const subs = await loadSubscriptions();
  assert.equal(subs.enabled, false, "disabled by default");
  assert.deepEqual(subs.events, { prOpened: true, ciCompleted: true }, "events default on");
  assert.deepEqual(subs.repos, [], "no repos by default");
}

{
  const subs = await patchSubscriptions({
    enabled: true,
    repos: ["OpenCoven/coven-cave", "OpenCoven/coven", "  ", "OpenCoven/coven-cave"],
  });
  assert.equal(subs.enabled, true, "enable persisted");
  assert.deepEqual(
    subs.repos,
    ["OpenCoven/coven-cave", "OpenCoven/coven"],
    "repos deduped, blanks dropped",
  );
}

{
  const subs = await patchSubscriptions({ events: { ciCompleted: false } });
  assert.deepEqual(
    subs.events,
    { prOpened: true, ciCompleted: false },
    "partial event patch keeps the other flag",
  );
}

// Cursor persists, then is dropped when its repo is unwatched.
{
  await updateCursor("OpenCoven/coven", { prOpenedAt: "2026-07-12T00:00:00Z" });
  let subs = await loadSubscriptions();
  assert.equal(
    subs.cursors["OpenCoven/coven"]?.prOpenedAt,
    "2026-07-12T00:00:00Z",
    "cursor persisted",
  );
  subs = await patchSubscriptions({ repos: ["OpenCoven/coven-cave"] });
  assert.equal(subs.cursors["OpenCoven/coven"], undefined, "unwatched repo cursor dropped");
}

// ── diffOpenedPrs ────────────────────────────────────────────────────────────
const pr = (number, created_at) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/o/r/pull/${number}`,
  created_at,
});

{
  // First poll: never notify a backlog, just seed the cursor.
  const { fresh, nextCursor } = diffOpenedPrs(
    [pr(2, "2026-07-11T10:00:00Z"), pr(1, "2026-07-10T10:00:00Z")],
    null,
  );
  assert.deepEqual(fresh, [], "first poll reports nothing");
  assert.equal(nextCursor, "2026-07-11T10:00:00Z", "cursor seeded to newest");
}

{
  const { fresh, nextCursor } = diffOpenedPrs(
    [pr(3, "2026-07-12T09:00:00Z"), pr(2, "2026-07-11T10:00:00Z")],
    "2026-07-11T10:00:00Z",
  );
  assert.deepEqual(fresh.map((p) => p.number), [3], "only strictly newer PRs");
  assert.equal(nextCursor, "2026-07-12T09:00:00Z", "cursor advances");
}

{
  const { fresh, nextCursor } = diffOpenedPrs([], "2026-07-11T10:00:00Z");
  assert.deepEqual(fresh, [], "empty list reports nothing");
  assert.equal(nextCursor, "2026-07-11T10:00:00Z", "cursor never regresses");
}

// ── diffCompletedRuns ────────────────────────────────────────────────────────
const run = (id, updated_at, conclusion = "success") => ({
  id,
  name: "CI",
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  updated_at,
  conclusion,
});

{
  // First poll seeds cursor + seen ids, no notifications.
  const { fresh, nextCursor, nextSeenIds } = diffCompletedRuns(
    [run(10, "2026-07-11T10:00:00Z"), run(11, "2026-07-11T11:00:00Z")],
    null,
    undefined,
  );
  assert.deepEqual(fresh, [], "first poll reports nothing");
  assert.equal(nextCursor, "2026-07-11T11:00:00Z", "cursor seeded");
  assert.deepEqual(nextSeenIds, [10, 11], "seen ids seeded");
}

{
  // Tie on updated_at is caught by the seen-id set, not double-notified.
  const { fresh, nextSeenIds } = diffCompletedRuns(
    [run(11, "2026-07-11T11:00:00Z"), run(12, "2026-07-11T11:00:00Z")],
    "2026-07-11T11:00:00Z",
    [11],
  );
  assert.deepEqual(fresh.map((r) => r.id), [12], "tie deduped by id");
  assert.ok(nextSeenIds.includes(12) && nextSeenIds.includes(11), "seen ids accumulate");
}

{
  // Non-actionable conclusions are ignored entirely.
  const { fresh, nextCursor } = diffCompletedRuns(
    [
      run(20, "2026-07-12T01:00:00Z", "cancelled"),
      run(21, "2026-07-12T02:00:00Z", "skipped"),
      run(22, "2026-07-12T03:00:00Z", "failure"),
    ],
    "2026-07-11T00:00:00Z",
    [],
  );
  assert.deepEqual(fresh.map((r) => r.id), [22], "only actionable conclusions notify");
  assert.equal(nextCursor, "2026-07-12T03:00:00Z", "cursor from actionable runs");
}

{
  // Seen-id list stays capped.
  const seed = Array.from({ length: SEEN_RUN_IDS_CAP }, (_, i) => i + 1000);
  const { nextSeenIds } = diffCompletedRuns(
    [run(1, "2026-07-12T05:00:00Z")],
    "2026-07-12T00:00:00Z",
    seed,
  );
  assert.equal(nextSeenIds.length, SEEN_RUN_IDS_CAP, "seen ids capped");
  assert.equal(nextSeenIds[0], 1, "newest id kept at front");
}

console.log("github-subscriptions tests passed");
