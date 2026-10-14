// @ts-nocheck
// The launcher's Reviews group (Chat.dc.html 2b, cave-umgkh) offers pull
// requests waiting on YOU, and since #5930 your own open pull requests when
// "Include my pull requests in Reviews" is on. Assigned issues and PRs someone
// else wrote that merely list you as assignee still never qualify.
import assert from "node:assert/strict";
import { test } from "node:test";

import { repoLabel, reviewRequestLabel, reviewRequestSub, reviewRequests } from "./chat-review-requests.ts";

const item = (over = {}) => ({
  id: "1",
  kind: "review_request",
  repo: "OpenCoven/terminal-ui",
  number: 54,
  title: "sync README with components",
  url: "https://github.com/OpenCoven/terminal-ui/pull/54",
  state: "open",
  updatedAt: "2026-07-29T04:00:00.000Z",
  ...over,
});

test("only review requests qualify — not your own PRs or assigned issues", () => {
  const rows = reviewRequests([
    item({ id: "review" }),
    item({ id: "mine", kind: "pr" }),
    item({ id: "issue", kind: "issue" }),
    item({ id: "notif", kind: "notification" }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["review"]);
});

test("a closed PR is no longer waiting on anyone", () => {
  const rows = reviewRequests([item({ id: "open" }), item({ id: "shut", state: "closed" })]);
  assert.deepEqual(rows.map((r) => r.id), ["open"]);
});

test("the row names the repo and number, then the title", () => {
  const [row] = reviewRequests([item()]);
  assert.equal(row.title, "terminal-ui #54 — sync README with components");
  assert.equal(row.badge, "open");
  assert.equal(row.need, "needs review");
});

test("a draft PR reads as blocked, not as review you are holding up", () => {
  const [row] = reviewRequests([item({ draft: true })]);
  assert.equal(row.badge, "draft");
  assert.equal(row.need, "blocked");
});

test("rows come freshest first and cap without reordering", () => {
  const items = [
    item({ id: "old", updatedAt: "2026-07-01T00:00:00.000Z" }),
    item({ id: "new", updatedAt: "2026-07-29T00:00:00.000Z" }),
    item({ id: "mid", updatedAt: "2026-07-15T00:00:00.000Z" }),
  ];
  assert.deepEqual(reviewRequests(items).map((r) => r.id), ["new", "mid", "old"]);
  assert.deepEqual(reviewRequests(items, { cap: 2 }).map((r) => r.id), ["new", "mid"]);
});

test("the repo reads as its tail inside the Cave", () => {
  assert.equal(repoLabel("OpenCoven/coven-cave"), "coven-cave");
  assert.equal(repoLabel("coven-cave"), "coven-cave");
  assert.equal(repoLabel("  "), "");
});

test("a PR with no repo or number still renders a usable row", () => {
  const [row] = reviewRequests([item({ repo: "", number: undefined })]);
  assert.equal(row.title, "sync README with components");
});

test("the accessible name says what the PR needs", () => {
  const [row] = reviewRequests([item()]);
  assert.equal(
    reviewRequestLabel(row),
    "Review 'terminal-ui #54 — sync README with components' — needs review",
  );
});

// ── #5930: your own pull requests ────────────────────────────────────────────

const mine = (over = {}) =>
  item({
    id: "own",
    kind: "pr",
    authored: true,
    repo: "OpenCoven/coven-cave",
    number: 5930,
    title: "include my own PRs",
    url: "https://github.com/OpenCoven/coven-cave/pull/5930",
    ...over,
  });

test("without includeOwn your own pull requests stay out (the old rule)", () => {
  const rows = reviewRequests([item({ id: "review" }), mine()]);
  assert.deepEqual(rows.map((r) => r.id), ["review"]);
});

test("includeOwn admits open PRs you wrote, marked as yours", () => {
  const rows = reviewRequests([item({ id: "review" }), mine()], { includeOwn: true });
  assert.deepEqual(rows.map((r) => r.id), ["review", "own"]);
  const own = rows.find((r) => r.id === "own");
  assert.equal(own.own, true);
  assert.equal(own.badge, "yours");
  assert.equal(own.need, "self-review");
  assert.equal(own.title, "coven-cave #5930 — include my own PRs");
  const theirs = rows.find((r) => r.id === "review");
  assert.equal(theirs.own, false);
});

test("includeOwn still needs the authored flag — an assigned PR someone else wrote stays out", () => {
  const rows = reviewRequests(
    [mine({ id: "assigned-not-mine", authored: undefined }), mine({ id: "issue", kind: "issue" })],
    { includeOwn: true },
  );
  assert.deepEqual(rows, []);
});

test("a closed or merged PR of yours is not offered", () => {
  const rows = reviewRequests(
    [mine({ id: "open" }), mine({ id: "closed", state: "closed" }), mine({ id: "merged", state: "merged" })],
    { includeOwn: true },
  );
  assert.deepEqual(rows.map((r) => r.id), ["open"]);
});

test("your draft reads as blocked while automatic review is off", () => {
  const [row] = reviewRequests([mine({ draft: true })], { includeOwn: true });
  assert.equal(row.badge, "yours");
  assert.equal(row.draft, true);
  assert.equal(row.need, "blocked");
});

test("your draft reads as reviews when ready while automatic review is on", () => {
  const [row] = reviewRequests([mine({ draft: true })], { includeOwn: true, autoReview: true });
  assert.equal(row.need, "reviews when ready");
  // Automatic review only changes how YOUR drafts read.
  const [theirs] = reviewRequests([item({ draft: true })], { includeOwn: true, autoReview: true });
  assert.equal(theirs.need, "blocked");
});

test("requests waiting on you come before your own PRs, each freshest first", () => {
  const rows = reviewRequests(
    [
      mine({ id: "own-new", updatedAt: "2026-10-11T00:00:00.000Z", url: "u1" }),
      item({ id: "req-old", updatedAt: "2026-07-01T00:00:00.000Z", url: "u2" }),
      mine({ id: "own-old", updatedAt: "2026-08-01T00:00:00.000Z", url: "u3" }),
      item({ id: "req-new", updatedAt: "2026-09-01T00:00:00.000Z", url: "u4" }),
    ],
    { includeOwn: true, cap: 3 },
  );
  assert.deepEqual(rows.map((r) => r.id), ["req-new", "req-old", "own-new"]);
});

test("the second line says draft and what it needs; ready rows say what they need", () => {
  const [draft] = reviewRequests([mine({ draft: true })], { includeOwn: true, autoReview: true });
  assert.deepEqual(reviewRequestSub(draft), ["draft", "reviews when ready"]);
  const [ready] = reviewRequests([mine()], { includeOwn: true });
  assert.deepEqual(reviewRequestSub(ready), ["self-review"]);
  const [theirs] = reviewRequests([item()]);
  assert.deepEqual(reviewRequestSub(theirs), ["needs review"]);
});

test("the accessible name says the pull request is yours", () => {
  const [row] = reviewRequests([mine()], { includeOwn: true });
  assert.equal(
    reviewRequestLabel(row),
    "Review your pull request 'coven-cave #5930 — include my own PRs' — self-review",
  );
});
