// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildSessionGroups,
  completedCardsForDay,
  dailyFactsHash,
  reportSessionTitle,
  unionMergedPrs,
} from "./daily-report-facts.ts";

const now = new Date("2026-06-18T21:15:00.000Z");

const session = (over) => ({
  id: "s1",
  title: "Fix board chat route",
  status: "completed",
  updated_at: "2026-06-18T20:00:00.000Z",
  created_at: "2026-06-18T19:00:00.000Z",
  project_root: "/repo/coven-cave",
  harness: "codex",
  exit_code: 0,
  archived_at: null,
  ...over,
});

// ── Session groups ──────────────────────────────────────────────────────────
{
  const groups = buildSessionGroups(
    [
      session({ id: "a1", project_root: "/repo/coven-cave", diff: { additions: 10, deletions: 2 } }),
      session({
        id: "a2",
        project_root: "/repo/coven-cave",
        title: "fix board chat route",
        updated_at: "2026-06-18T19:30:00.000Z",
        diff: { additions: 5, deletions: 1 },
      }),
      session({
        id: "b1",
        project_root: "/repo/open-meow",
        title: "Ship the parser",
        updated_at: "2026-06-18T18:00:00.000Z",
        pullRequest: { repo: "OpenCoven/open-meow", number: 26, url: "https://github.com/OpenCoven/open-meow/pull/26", state: "merged" },
      }),
      session({ id: "old", updated_at: "2026-06-17T18:00:00.000Z" }),
      session({ id: "arch", archived_at: "2026-06-18T12:00:00.000Z" }),
    ],
    now,
  );
  assert.equal(groups.length, 2, "sessions should group by project, today only");
  const cave = groups.find((g) => g.label === "coven-cave");
  assert.ok(cave, "group label should be the project basename");
  assert.equal(cave.sessions.length, 1, "duplicate titles should dedupe within a group");
  assert.equal(cave.additions, 15, "group totals should sum every session, not just listed ones");
  assert.equal(cave.deletions, 3);
  const meow = groups.find((g) => g.label === "open-meow");
  assert.equal(meow.sessions[0].pr?.number, 26, "session PR context should ride into the group");
}

// ── Completed cards ─────────────────────────────────────────────────────────
{
  const cards = completedCardsForDay(
    [
      { id: "c1", title: "Ship it", lifecycle: "completed", lifecycleAt: "2026-06-18T15:00:00.000Z", updatedAt: "2026-06-18T15:00:00.000Z" },
      { id: "c2", title: "Dragged to done", status: "done", lifecycle: "review", lifecycleAt: null, updatedAt: "2026-06-18T16:00:00.000Z" },
      { id: "c3", title: "Old completion", lifecycle: "completed", lifecycleAt: "2026-06-17T15:00:00.000Z", updatedAt: "2026-06-17T15:00:00.000Z" },
      { id: "c4", title: "Still running", lifecycle: "running", lifecycleAt: "2026-06-18T15:00:00.000Z", updatedAt: "2026-06-18T15:00:00.000Z" },
    ],
    now,
  );
  assert.deepEqual(
    cards.map((c) => c.id),
    ["c2", "c1"],
    "completed = lifecycle completed today or dragged to done today, newest first",
  );
}

// ── Merged PR union ─────────────────────────────────────────────────────────
{
  const gh = [
    { repo: "OpenCoven/coven-cave", number: 2497, title: "keep today's report live", url: "https://github.com/OpenCoven/coven-cave/pull/2497", mergedAt: "2026-06-18T17:00:00.000Z" },
  ];
  const withPrSession = [
    session({
      id: "pr1",
      pullRequest: { repo: "OpenCoven/open-meow", number: 26, url: "https://github.com/OpenCoven/open-meow/pull/26", state: "merged" },
    }),
    session({
      id: "pr2",
      pullRequest: { repo: "OpenCoven/coven-cave", number: 2497, url: "https://github.com/OpenCoven/coven-cave/pull/2497", state: "merged" },
    }),
    session({ id: "pr3", pullRequest: { repo: "OpenCoven/coven-cave", number: 9, url: "", state: "open" } }),
  ];
  const union = unionMergedPrs(gh, withPrSession, now);
  assert.equal(union.length, 2, "GitHub and session PRs should union, deduped by repo#number");
  assert.equal(
    union.find((pr) => pr.number === 2497).title,
    "keep today's report live",
    "GitHub data should win the dedupe (real title)",
  );
  assert.equal(
    unionMergedPrs(null, [session({ id: "plain" })], now),
    undefined,
    "no PAT and no session PRs should yield an absent section, not an empty one",
  );
  assert.equal(
    unionMergedPrs(null, withPrSession, now).length,
    2,
    "session-attached merged PRs should surface even without a PAT",
  );
}

// ── Facts hash ──────────────────────────────────────────────────────────────
{
  const stats = { reminders: 1, responses: 0, familiars: 0, sessions: 2 };
  const groups = buildSessionGroups([session({ id: "h1" })], now);
  const a = dailyFactsHash({ stats, sessionGroups: groups });
  assert.equal(a, dailyFactsHash({ stats, sessionGroups: groups }), "hash should be stable");
  assert.notEqual(
    a,
    dailyFactsHash({ stats: { ...stats, sessions: 3 }, sessionGroups: groups }),
    "changed facts should change the hash",
  );
  assert.equal(
    a,
    dailyFactsHash({
      stats,
      sessionGroups: groups.map((g) => ({ ...g, sessions: [...g.sessions] })),
    }),
    "hash should not depend on object identity",
  );
}

// ── Title hygiene (canonical home of reportSessionTitle) ────────────────────
assert.equal(
  reportSessionTitle({ title: "## Prior conversation **User:** Merge PR #26 **" }),
  "Untitled session",
);
assert.equal(reportSessionTitle({ title: "**Fix** the `parser`" }), "Fix the parser");


// Angle-tag prompt-preamble leaks ("<covenroster> You are in a group chat…")
// are not names — seen live 2026-07-06.
assert.equal(
  reportSessionTitle({ title: '<covenroster> You are in a group chat ("coven") with these…' }),
  "Untitled session",
);

console.log("daily-report-facts.test.ts: ok");
