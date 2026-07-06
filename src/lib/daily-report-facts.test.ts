// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildSessionGroups,
  completedCardsForDay,
  dailyFactsHash,
  unionMergedPrs,
} from "./daily-report-facts.ts";

const now = new Date("2026-06-18T21:15:00.000Z");
const todayIso = (h) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

const session = (over = {}) => ({
  id: "s1",
  title: "Fix board chat route",
  status: "completed",
  updated_at: todayIso(1),
  created_at: todayIso(2),
  project_root: "/repo/coven-cave",
  harness: "codex",
  model: "gpt-5",
  exit_code: 0,
  archived_at: null,
  familiarId: "sage",
  ...over,
});

// --- buildSessionGroups ------------------------------------------------------

{
  const groups = buildSessionGroups(
    [
      session({ id: "a1", diff: { additions: 10, deletions: 2 } }),
      session({ id: "a2", title: "Ship calendar fixes", diff: { additions: 5, deletions: 1 } }),
      session({ id: "b1", project_root: "/repo/open-meow/", title: "Meow work" }),
      session({ id: "old", updated_at: "2026-06-10T09:00:00.000Z" }),
      session({ id: "arch", archived_at: todayIso(1) }),
    ],
    now,
  );
  assert.equal(groups.length, 2, "groups by project_root, today's non-archived sessions only");
  const cave = groups.find((g) => g.key === "/repo/coven-cave");
  assert.equal(cave.label, "coven-cave", "label is the root's basename");
  assert.equal(cave.additions, 15);
  assert.equal(cave.deletions, 3);
  assert.equal(cave.sessions.length, 2);
  const meow = groups.find((g) => g.key === "/repo/open-meow/");
  assert.equal(meow.label, "open-meow", "trailing slash does not break the basename");
}

{
  const many = [];
  for (let g = 0; g < 8; g++) {
    for (let s = 0; s < 7; s++) {
      many.push(session({ id: `g${g}s${s}`, project_root: `/repo/p${g}`, updated_at: todayIso(g + s / 10) }));
    }
  }
  const groups = buildSessionGroups(many, now);
  assert.equal(groups.length, 6, "caps at 6 groups");
  assert.ok(
    groups.every((g) => g.sessions.length <= 5),
    "caps at 5 sessions per group",
  );
}

// --- unionMergedPrs ----------------------------------------------------------

{
  assert.equal(unionMergedPrs(null, [session()], now), null, "null when no source has PRs");

  const sessionPr = session({
    id: "pr1",
    title: "Land the picker",
    pullRequest: { repo: "OpenCoven/coven-cave", number: 42, state: "merged" },
  });
  const openPr = session({
    id: "pr2",
    pullRequest: { repo: "OpenCoven/coven-cave", number: 43, state: "open" },
  });
  const fromSessions = unionMergedPrs(null, [sessionPr, openPr], now);
  assert.equal(fromSessions.length, 1, "only merged session PRs count (PAT-less partial data)");
  assert.equal(fromSessions[0].number, 42);
  assert.match(fromSessions[0].url, /\/pull\/42$/, "synthesizes a URL when the session lacks one");

  const github = [
    {
      repo: "OpenCoven/coven-cave",
      number: 42,
      title: "feat: land the picker properly",
      url: "https://github.com/OpenCoven/coven-cave/pull/42",
      mergedAt: todayIso(2),
    },
    {
      repo: "OpenCoven/open-meow",
      number: 7,
      title: "fix: purr",
      url: "https://github.com/OpenCoven/open-meow/pull/7",
      mergedAt: todayIso(3),
    },
  ];
  const union = unionMergedPrs(github, [sessionPr], now);
  assert.equal(union.length, 2, "dedupes on repo#number across sources");
  assert.equal(
    union.find((pr) => pr.number === 42).title,
    "feat: land the picker properly",
    "richer GitHub search entry wins over the session-derived one",
  );

  const emptyGithub = unionMergedPrs([], [], now);
  assert.deepEqual(emptyGithub, [], "a working PAT with zero merges is [] (absence ≠ zero)");
}

// --- completedCardsForDay ----------------------------------------------------

{
  const cards = [
    { id: "c1", title: "Done today", lifecycle: "completed", lifecycleAt: todayIso(2) },
    { id: "c2", title: "Done yesterday", lifecycle: "completed", lifecycleAt: "2026-06-17T10:00:00.000Z" },
    { id: "c3", title: "Still running", lifecycle: "running", lifecycleAt: todayIso(1) },
    { id: "c4", title: "Legacy done", status: "done", updatedAt: todayIso(3) },
    { id: "c5", title: "Legacy stale", status: "done", updatedAt: "2026-06-01T10:00:00.000Z" },
  ];
  const done = completedCardsForDay(cards, now);
  assert.deepEqual(
    done.map((card) => card.id),
    ["c1", "c4"],
    "completed-today lifecycle plus legacy done-updated-today fallback, newest first",
  );
}

// --- dailyFactsHash ----------------------------------------------------------

{
  const facts = {
    prsMerged: [
      { repo: "r", number: 1, title: "a", url: "u", mergedAt: todayIso(1) },
      { repo: "r", number: 2, title: "b", url: "u", mergedAt: todayIso(2) },
    ],
    cardsCompleted: [{ id: "c1", title: "t", completedAt: todayIso(1) }],
    sessionGroups: buildSessionGroups([session()], now),
  };
  const h1 = dailyFactsHash(facts);
  assert.equal(h1, dailyFactsHash(facts), "stable for identical facts");
  assert.equal(
    h1,
    dailyFactsHash({ ...facts, prsMerged: [...facts.prsMerged].reverse() }),
    "order-insensitive",
  );
  assert.equal(
    h1,
    dailyFactsHash({
      ...facts,
      prsMerged: facts.prsMerged.map((pr) => ({ ...pr, mergedAt: todayIso(5) })),
    }),
    "timestamps do not churn the hash",
  );
  assert.notEqual(
    h1,
    dailyFactsHash({ ...facts, cardsCompleted: [] }),
    "content changes do change the hash",
  );
}

console.log("daily-report-facts.test.ts: ok");
