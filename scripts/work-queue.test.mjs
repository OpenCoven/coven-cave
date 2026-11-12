// Contract for scripts/work-queue.mjs: the compact `cave-work:v1` issue block,
// the lane/state lint, the queue listing, and the guarded manifest apply.
// Everything here runs on fixtures; no test reaches GitHub.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyManifest,
  bodyDigest,
  lintIssue,
  manifestTable,
  parseWorkBlock,
  planActions,
  proposeEntry,
  queueRows,
  renderWorkBlock,
  replaceLeadBlock,
  retryRateLimited,
} from "./work-queue.mjs";

const BLOCK = [
  "<!-- cave-work:v1:start -->",
  "lane: native",
  "state: needs-device",
  "owner: BunsDev",
  "unit: fix/issue-6090-bounce · PR #6385 (draft)",
  "blocked-by: —",
  "clears-when: rendered acceptance on a physical iPhone",
  "next: Inspect the cancelled native run, then continue #6385.",
  "updated: 2026-11-11",
  "<!-- cave-work:v1:end -->",
].join("\n");

const GOALS = [
  "<!-- cave-goals:2026-11-05:v1:start -->",
  "## Current goals — 5 November 2026",
  "",
  "**Routing:** Keep; independent urgent lane. **Lane:** native.",
  "",
  "**Responsible owner:** Existing native owner.",
  "",
  "**Next step:** Inspect the cancelled native run, then continue #6385.",
  "",
  "### Long-running goal prompt",
  "<!-- cave-goals:2026-11-05:v1:end -->",
].join("\n");

const ORIGINAL = "\n\n## Problem\n\nThe transcript bounces.\n";

function issue(overrides = {}) {
  return {
    number: 6090,
    title: "fix(ios): stop latest-message scroll feedback loop",
    body: `${BLOCK}${ORIGINAL}`,
    labels: ["lane:native", "state:needs-device"],
    assignees: ["BunsDev"],
    comments: 28,
    parent: 6453,
    subIssues: 0,
    blockedBy: [],
    ...overrides,
  };
}

test("parseWorkBlock reads the fields and treats a dash as empty", () => {
  const block = parseWorkBlock(`${BLOCK}${ORIGINAL}`);
  assert.equal(block.lane, "native");
  assert.equal(block.state, "needs-device");
  assert.equal(block["blocked-by"], "");
  assert.equal(block.next, "Inspect the cancelled native run, then continue #6385.");
});

test("parseWorkBlock returns null when the body has no block", () => {
  assert.equal(parseWorkBlock("## Problem\n\nNo block here."), null);
  assert.equal(parseWorkBlock(null), null);
});

test("renderWorkBlock round-trips and keeps one fixed field order", () => {
  const shuffled = { updated: "2026-11-11", next: "Go.", owner: "BunsDev", state: "ready", lane: "release" };
  const rendered = renderWorkBlock(shuffled);
  assert.deepEqual(
    rendered.split("\n").slice(1, -1).map((line) => line.split(":")[0]),
    ["lane", "state", "owner", "unit", "blocked-by", "clears-when", "next", "updated"],
  );
  assert.equal(parseWorkBlock(rendered).next, "Go.");
  assert.match(rendered, /^unit: —$/m);
});

test("renderWorkBlock leaves state out for an epic and flattens newlines", () => {
  const rendered = renderWorkBlock({ lane: "native", owner: "BunsDev", next: "Work the\nsub-issues.", updated: "2026-11-11" });
  assert.doesNotMatch(rendered, /^state:/m);
  assert.match(rendered, /^next: Work the sub-issues\.$/m);
});

test("replaceLeadBlock swaps the goals block and leaves the rest byte-identical", () => {
  const result = replaceLeadBlock(`${GOALS}${ORIGINAL}`, BLOCK);
  assert.equal(result.body, `${BLOCK}${ORIGINAL}`);
  assert.equal(result.removed, GOALS);
});

test("replaceLeadBlock replaces an existing work block without archiving it", () => {
  const next = BLOCK.replace("needs-device", "in-review");
  const result = replaceLeadBlock(`${BLOCK}${ORIGINAL}`, next);
  assert.equal(result.body, `${next}${ORIGINAL}`);
  assert.equal(result.removed, null);
});

test("replaceLeadBlock prepends the block when the body has neither", () => {
  const result = replaceLeadBlock("## Problem\n", BLOCK);
  assert.equal(result.body, `${BLOCK}\n\n## Problem\n`);
  assert.equal(result.removed, null);
});

test("lintIssue passes a labelled issue whose block agrees with its labels", () => {
  assert.deepEqual(lintIssue(issue(), { openPulls: new Set([6385]) }), []);
});

test("lintIssue requires exactly one lane and one state", () => {
  const none = lintIssue(issue({ labels: [] }));
  assert.ok(none.some((p) => /lane/.test(p)));
  assert.ok(none.some((p) => /state/.test(p)));
  const two = lintIssue(issue({ labels: ["lane:native", "state:ready", "state:blocked"] }));
  assert.ok(two.some((p) => /exactly one state/.test(p)));
});

test("lintIssue reports a missing block and a block that disagrees with the labels", () => {
  assert.ok(lintIssue(issue({ body: "## Problem\n" })).some((p) => /cave-work/.test(p)));
  const drift = lintIssue(issue({ labels: ["lane:release", "state:needs-device"] }));
  assert.ok(drift.some((p) => /block says lane native/.test(p)));
});

test("lintIssue rejects a blocked issue with neither a link nor a clearing condition", () => {
  const body = BLOCK.replace("state: needs-device", "state: blocked").replace(/clears-when: .*/, "clears-when: —");
  const blocked = issue({ body, labels: ["lane:native", "state:blocked"] });
  assert.ok(lintIssue(blocked).some((p) => /blocked/.test(p)));
  assert.deepEqual(lintIssue({ ...blocked, body: body.replace("blocked-by: —", "blocked-by: #5762"), blockedBy: [{ number: 5762, open: true }] }), []);
});

test("lintIssue rejects in-review without an open pull request in the unit", () => {
  const body = BLOCK.replace("state: needs-device", "state: in-review");
  const reviewing = issue({ body, labels: ["lane:native", "state:in-review"] });
  assert.deepEqual(lintIssue(reviewing, { openPulls: new Set([6385]) }), []);
  assert.ok(lintIssue(reviewing, { openPulls: new Set() }).some((p) => /open pull request/.test(p)));
});

test("lintIssue rejects ready work that still has an open blocker", () => {
  const body = BLOCK.replace("state: needs-device", "state: ready").replace("blocked-by: —", "blocked-by: #5762");
  const ready = issue({ body, labels: ["lane:native", "state:ready"], blockedBy: [{ number: 5762, open: true }] });
  assert.ok(lintIssue(ready).some((p) => /open blocker #5762/.test(p)));
});

test("lintIssue requires the block's blockers to match the native links", () => {
  const drift = issue({ blockedBy: [{ number: 5762, open: false }] });
  assert.ok(lintIssue(drift).some((p) => /blocked-by/.test(p)));
});

test("lintIssue flags a retired workflow label", () => {
  const retired = issue({ labels: ["lane:native", "state:needs-device", "workflow:handoff"] });
  assert.ok(lintIssue(retired).some((p) => /workflow:handoff/.test(p)));
});

test("lintIssue lets an epic carry a lane and no state", () => {
  const body = renderWorkBlock({ lane: "native", owner: "BunsDev", next: "Work the sub-issues.", updated: "2026-11-11" });
  assert.deepEqual(lintIssue(issue({ body, labels: ["epic", "lane:native"], parent: null, subIssues: 9 })), []);
});

test("queueRows --ready keeps only ready issues with no open blocker", () => {
  const readyBody = BLOCK.replace("state: needs-device", "state: ready");
  const issues = [
    issue({ number: 1, body: readyBody, labels: ["lane:native", "state:ready"] }),
    issue({ number: 2, body: readyBody, labels: ["lane:native", "state:ready"], blockedBy: [{ number: 9, open: true }] }),
    issue({ number: 3 }),
  ];
  assert.deepEqual(queueRows(issues, { ready: true }).map((row) => row.number), [1]);
  assert.deepEqual(queueRows(issues, { lane: "native" }).map((row) => row.number), [1, 2, 3]);
  assert.equal(queueRows(issues, {})[2].next, "Inspect the cancelled native run, then continue #6385.");
});

test("proposeEntry carries the lane and next step out of the goals block", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff", "workflow:dependency", "P1"], parent: null });
  const entry = proposeEntry(live, { state: "in-review", unit: "PR #6385 (draft)", parent: 6453 }, { today: "2026-11-11" });
  assert.equal(entry.block.lane, "native");
  assert.equal(entry.block.state, "in-review");
  assert.equal(entry.block.owner, "BunsDev");
  assert.equal(entry.block.next, "Inspect the cancelled native run, then continue #6385.");
  assert.deepEqual(entry.labels.add, ["lane:native", "state:in-review"]);
  assert.deepEqual(entry.labels.remove, ["workflow:dependency", "workflow:handoff"]);
  assert.equal(entry.parent, 6453);
  assert.equal(entry.archiveGoals, true);
  assert.deepEqual(entry.observed, { body: bodyDigest(live.body), labels: ["P1", "workflow:dependency", "workflow:handoff"], comments: 28 });
});

test("proposeEntry marks an issue unresolved when no lane or state can be named", () => {
  const entry = proposeEntry(issue({ body: "## Problem\n", labels: [] }), {}, { today: "2026-11-11" });
  assert.deepEqual(entry.unresolved, ["lane", "state"]);
});

function manifestEntry(live, overrides = {}) {
  return proposeEntry(live, { state: "in-review", unit: "PR #6385 (draft)", parent: 6453, blockedBy: [5762], ...overrides }, { today: "2026-11-11" });
}

test("planActions lists every change for an issue that has not moved", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const plan = planActions(manifestEntry(live), live, {});
  assert.equal(plan.skip, null);
  // The archive comment goes first: once the body is rewritten the old block is gone.
  assert.deepEqual(plan.actions.map((a) => a.kind), ["labels", "archive", "body", "parent", "blocked-by"]);
  assert.match(plan.actions[1].body, /cave-goals-archive/);
  assert.ok(plan.actions[1].body.includes(GOALS));
  assert.match(plan.actions[2].body, /^<!-- cave-work:v1:start -->/);
  assert.ok(plan.actions[2].body.endsWith(ORIGINAL));
});

test("planActions skips an issue whose body, labels or comments moved", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const entry = manifestEntry(live);
  assert.match(planActions(entry, { ...live, comments: 29 }, {}).skip, /changed since/);
  assert.match(planActions(entry, { ...live, body: `${live.body}edited` }, {}).skip, /changed since/);
});

test("planActions resumes a half-applied issue without repeating finished steps", () => {
  const before = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const entry = manifestEntry(before);
  const desiredBody = planActions(entry, before, {}).actions[2].body;
  const after = { ...before, body: desiredBody, labels: ["lane:native", "state:in-review"], comments: 29, archived: true, parent: 6453 };
  const plan = planActions(entry, after, {});
  assert.equal(plan.skip, null);
  assert.deepEqual(plan.actions.map((a) => a.kind), ["blocked-by"]);
});

test("planActions closes only when closures are explicitly included", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: [], parent: null });
  const entry = manifestEntry(live, { close: { reason: "not planned", comment: "Folded into #6259." } });
  assert.ok(!planActions(entry, live, {}).actions.some((a) => a.kind === "close"));
  assert.equal(planActions(entry, live, { includeClosures: true }).actions.at(-1).kind, "close");
});

test("applyManifest writes nothing in a dry run and reports what it would do", async () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const writes = [];
  const context = {
    fetchIssue: async () => live,
    write: async (action) => writes.push(action),
  };
  const report = await applyManifest(context, { issues: [manifestEntry(live)] }, { apply: false });
  assert.equal(writes.length, 0);
  assert.equal(report[0].number, 6090);
  assert.deepEqual(report[0].planned, ["labels", "archive", "body", "parent", "blocked-by"]);
});

test("applyManifest performs the planned writes in order when applying", async () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const writes = [];
  const context = {
    fetchIssue: async () => live,
    write: async (action) => writes.push(`${action.number}:${action.kind}`),
  };
  const report = await applyManifest(context, { issues: [manifestEntry(live)] }, { apply: true });
  assert.deepEqual(writes, ["6090:labels", "6090:archive", "6090:body", "6090:parent", "6090:blocked-by"]);
  assert.deepEqual(report[0].done, ["labels", "archive", "body", "parent", "blocked-by"]);
});

test("applyManifest stops an issue at its first failed write and moves on", async () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const context = {
    fetchIssue: async () => live,
    write: async (action) => {
      if (action.kind === "archive") throw new Error("HTTP 502");
    },
  };
  const report = await applyManifest(context, { issues: [manifestEntry(live)] }, { apply: true });
  assert.deepEqual(report[0].done, ["labels"]);
  assert.match(report[0].failed, /archive: HTTP 502/);
});

test("manifestTable prints one reviewable row per issue", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff"], parent: null });
  const table = manifestTable({ issues: [manifestEntry(live)] });
  assert.match(table, /\| #6090 \| native \| in-review \| #6453 \| #5762 \|/);
});

test("applyManifest refuses an entry that still has unresolved fields", async () => {
  const live = issue({ body: "## Problem\n", labels: [], parent: null });
  const context = { fetchIssue: async () => live, write: async () => assert.fail("must not write") };
  const report = await applyManifest(context, { issues: [proposeEntry(live, {}, { today: "2026-11-11" })] }, { apply: true });
  assert.match(report[0].skipped, /unresolved/);
});

test("retryRateLimited waits and retries a rate-limited call, then returns its result", () => {
  const waits = [];
  let calls = 0;
  const result = retryRateLimited(
    () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("gh failed"), { stderr: "gh: API rate limit already exceeded for user ID 1." });
      return "ok";
    },
    { sleep: (ms) => waits.push(ms) },
  );
  assert.equal(result, "ok");
  assert.deepEqual(waits, [30_000, 60_000]);
});

test("retryRateLimited gives up after its attempts and reports only gh's own message", () => {
  const limited = () => {
    throw Object.assign(new Error("Command failed: gh api graphql -f query=..."), { stderr: "gh: You have exceeded a secondary rate limit.\n" });
  };
  assert.throws(() => retryRateLimited(limited, { sleep: () => {} }), { message: "gh: You have exceeded a secondary rate limit." });
});

test("retryRateLimited does not retry an ordinary failure", () => {
  let calls = 0;
  const missing = () => {
    calls += 1;
    throw Object.assign(new Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)" });
  };
  assert.throws(() => retryRateLimited(missing, { sleep: () => assert.fail("must not wait") }), { message: "gh: Not Found (HTTP 404)" });
  assert.equal(calls, 1);
});

test("proposeEntry can promote a parent issue to an epic, which carries no state", () => {
  const live = issue({ body: `${GOALS}${ORIGINAL}`, labels: ["workflow:handoff", "state:ready"], parent: null, subIssues: 6 });
  const entry = proposeEntry(live, { epic: true }, { today: "2026-11-11" });
  assert.deepEqual(entry.labels.add, ["epic", "lane:native"]);
  assert.deepEqual(entry.labels.remove, ["state:ready", "workflow:handoff"]);
  assert.equal(entry.block.state, undefined);
  assert.deepEqual(entry.unresolved, []);
});

test("lintIssue questions an in-progress claim that has not been refreshed for a week", () => {
  const body = BLOCK.replace("state: needs-device", "state: in-progress");
  const claimed = issue({ body, labels: ["lane:native", "state:in-progress"] });
  assert.deepEqual(lintIssue(claimed, { today: "2026-11-17" }), []);
  assert.ok(lintIssue(claimed, { today: "2026-11-19" }).some((p) => /in-progress since 2026-11-11/.test(p)));
});

test("queueRows --ready leaves out work another session has in progress", () => {
  const body = BLOCK.replace("state: needs-device", "state: in-progress");
  assert.deepEqual(queueRows([issue({ body, labels: ["lane:native", "state:in-progress"] })], { ready: true }), []);
});
