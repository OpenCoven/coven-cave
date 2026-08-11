import assert from "node:assert/strict";
import {
  deriveStage,
  facetsFor,
  groupIntoSections,
  signalSegments,
  GH_NEXT_STEP,
  type GhRowLinkage,
  type GhStreamEntry,
} from "./github-stage.ts";
import type { GitHubItem } from "./github-tasks.ts";

const NO_LINK: GhRowLinkage = { linkedCount: 0, session: null };

function item(over: Partial<GitHubItem> = {}): GitHubItem {
  return {
    kind: "pr",
    id: over.id ?? "i1",
    title: "t",
    repo: "OpenCoven/coven-cave",
    number: 1,
    url: "https://github.com/OpenCoven/coven-cave/pull/1",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function entry(over: Partial<GitHubItem> = {}, link: GhRowLinkage = NO_LINK): GhStreamEntry {
  const row = item(over);
  return { row, stage: deriveStage(row, link), ...link };
}

// ── Stage derivation ─────────────────────────────────────────────────────────

assert.equal(deriveStage(item({ checkStatus: "failing" }), NO_LINK).key, "checks-failing");
assert.equal(deriveStage(item({ checkStatus: "pending" }), NO_LINK).key, "checks-running");
assert.equal(deriveStage(item({ checkStatus: "passing" }), NO_LINK).key, "ready");

// A null rollup is "not reported", never "ready" — the badge must not claim a
// green CI run that was never fetched.
assert.equal(deriveStage(item({}), NO_LINK).key, "open");
assert.equal(deriveStage(item({ checkStatus: null }), NO_LINK).key, "open");

// Draft outranks CI: a draft is not asking for anything, so a red check on one
// is the author's problem and does not belong in a triage queue.
assert.equal(deriveStage(item({ draft: true, checkStatus: "failing" }), NO_LINK).key, "draft");

// Closed outranks the check rollup, which goes stale the moment a PR lands.
assert.equal(deriveStage(item({ state: "closed", checkStatus: "passing" }), NO_LINK).key, "closed");
assert.equal(deriveStage(item({ state: "merged", checkStatus: "failing" }), NO_LINK).key, "closed");

assert.equal(deriveStage(item({ kind: "review_request", state: "review_requested" }), NO_LINK).key, "review-requested");
assert.equal(deriveStage(item({ kind: "notification" }), NO_LINK).key, "mentioned");

// Issues: a linked familiar session beats the label check, an unlabelled issue
// is untriaged, and a labelled one is merely open.
assert.equal(
  deriveStage(item({ kind: "issue", labels: [] }), { linkedCount: 1, session: "cave-8i8q5" }).key,
  "in-progress",
);
assert.equal(deriveStage(item({ kind: "issue", labels: [] }), NO_LINK).key, "untriaged");
assert.equal(deriveStage(item({ kind: "issue", labels: ["bug"] }), NO_LINK).key, "open");
assert.equal(deriveStage(item({ kind: "issue", state: "closed", labels: [] }), NO_LINK).key, "closed");

// Every stage has next-step copy — an empty peek row is worse than no peek row.
for (const key of Object.keys(GH_NEXT_STEP)) {
  assert.ok(GH_NEXT_STEP[key as keyof typeof GH_NEXT_STEP].length > 0, `${key} has next-step copy`);
}

// ── Sections ─────────────────────────────────────────────────────────────────

const activity = groupIntoSections("all", [
  entry({ id: "a", kind: "review_request" }),
  entry({ id: "b", checkStatus: "failing" }),
  entry({ id: "c", checkStatus: "passing" }, { linkedCount: 1, session: "cave-1" }),
  entry({ id: "d", checkStatus: "passing" }),
]);
assert.deepEqual(activity.map((s) => s.key), ["needs", "familiars", "rest"]);
assert.deepEqual(activity[0].entries.map((e) => e.row.id), ["a", "b"], "blocking stages lead");
assert.deepEqual(activity[1].entries.map((e) => e.row.id), ["c"], "linked work is its own bucket");
assert.deepEqual(activity[2].entries.map((e) => e.row.id), ["d"]);

// First match wins: a failing PR that also has linked work stays in Needs you,
// so a row is never counted twice across the headings.
const both = groupIntoSections("all", [
  entry({ id: "x", checkStatus: "failing" }, { linkedCount: 2, session: "cave-2" }),
]);
assert.equal(both.length, 1);
assert.equal(both[0].key, "needs");

// Empty sections are dropped rather than rendered as a bare heading.
const onlyDraft = groupIntoSections("pr", [entry({ id: "p", draft: true })]);
assert.deepEqual(onlyDraft.map((s) => s.key), ["draft"]);

const prs = groupIntoSections("pr", [
  entry({ id: "p1", checkStatus: "passing" }),
  entry({ id: "p2", checkStatus: "failing" }),
  entry({ id: "p3", draft: true }),
]);
assert.deepEqual(prs.map((s) => s.key), ["ready", "failing", "draft"], "most-blocking order, gaps closed");

const issues = groupIntoSections("issue", [
  entry({ id: "i1", kind: "issue", labels: [] }),
  entry({ id: "i2", kind: "issue", labels: ["bug"] }),
]);
assert.deepEqual(issues.map((s) => s.key), ["untriaged", "open"]);

// ── Facets ───────────────────────────────────────────────────────────────────

// Facet parity: chips are the sections, so a chip count can never disagree
// with the rows under the heading it names.
const facets = facetsFor(activity);
assert.deepEqual(
  facets.map((f) => [f.key, f.count, f.label]),
  activity.map((s) => [s.key, s.entries.length, s.label]),
);

// ── Signal segments ──────────────────────────────────────────────────────────

assert.deepEqual(signalSegments(entry({ checkStatus: "failing" })), ["bad", "mute", "mute"]);
assert.deepEqual(
  signalSegments(entry({ checkStatus: "passing" }, { linkedCount: 1, session: "s" })),
  ["ok", "acc", "mute"],
);
assert.deepEqual(signalSegments(entry({ kind: "issue", labels: [] })), ["mute", "mute", "warn"]);
assert.equal(signalSegments(entry({})).length, 3, "always three fixed slots");

console.log("github-stage.test.ts ✓");
