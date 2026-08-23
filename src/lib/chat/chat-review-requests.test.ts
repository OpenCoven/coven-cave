// @ts-nocheck
// The launcher's Reviews group (Chat.dc.html 2b, cave-umgkh) offers pull
// requests waiting on YOU. /api/github/assigned also returns your own PRs and
// your assigned issues — offering those here would quietly redefine the group.
import assert from "node:assert/strict";
import { test } from "node:test";

import { repoLabel, reviewRequestLabel, reviewRequests } from "./chat-review-requests.ts";

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
