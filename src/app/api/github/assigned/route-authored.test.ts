// @ts-nocheck
// #5930: the Reviews group can offer your own pull requests, so the assigned
// route has to say which PRs are yours and which are drafts. The author:@me
// search marks its rows `authored: true`; both searches keep GitHub's `draft`
// flag (the mappers used to drop it); and the dedupe-by-URL keeps the FIRST
// copy it sees, so an assigned PR you also wrote must not lose `authored`.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "github-assigned-authored-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = path.join(home, ".coven", "cave");
process.env.GITHUB_TOKEN = "test-token-authored";

const pr = (over) => ({
  id: 1,
  number: 1,
  title: "t",
  html_url: "https://github.com/OpenCoven/coven-cave/pull/1",
  state: "open",
  updated_at: "2026-10-11T00:00:00Z",
  labels: [],
  pull_request: {},
  repository: { full_name: "OpenCoven/coven-cave" },
  ...over,
});

const ASSIGNED_AND_MINE = pr({ id: 10, number: 10, html_url: "https://github.com/OpenCoven/coven-cave/pull/10" });
const ASSIGNED_ISSUE = {
  ...pr({ id: 11, number: 11, html_url: "https://github.com/OpenCoven/coven-cave/issues/11" }),
  pull_request: undefined,
};
const REQUESTED_DRAFT = pr({ id: 20, number: 20, draft: true, html_url: "https://github.com/OpenCoven/terminal-ui/pull/20" });
const MY_DRAFT = pr({ id: 30, number: 30, draft: true, html_url: "https://github.com/OpenCoven/coven-cave/pull/30" });
const MY_READY = pr({ id: 31, number: 31, draft: false, html_url: "https://github.com/OpenCoven/coven-cave/pull/31" });

globalThis.fetch = async (url) => {
  const href = String(url);
  let body;
  if (href.includes("/issues?filter=assigned")) body = [ASSIGNED_AND_MINE, ASSIGNED_ISSUE];
  else if (href.includes("review-requested")) body = { total_count: 1, items: [REQUESTED_DRAFT] };
  else if (href.includes("author:@me")) body = { total_count: 3, items: [MY_DRAFT, MY_READY, ASSIGNED_AND_MINE] };
  else throw new Error(`unexpected fetch ${href}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const { GET } = await import("./route.ts");
const json = await (await GET()).json();
assert.equal(json.ok, true);
const byNumber = new Map(json.items.map((item) => [item.number, item]));

// The author:@me search marks its rows as yours and keeps GitHub's draft flag.
assert.equal(byNumber.get(30).kind, "pr");
assert.equal(byNumber.get(30).authored, true, "an authored-search row is marked authored");
assert.equal(byNumber.get(30).draft, true, "an authored draft stays a draft");
assert.equal(byNumber.get(31).authored, true);
assert.equal(byNumber.get(31).draft, false, "a ready authored PR is not a draft");

// The review-requested search keeps GitHub's draft flag too, and is never yours.
assert.equal(byNumber.get(20).kind, "review_request");
assert.equal(byNumber.get(20).draft, true, "a requested draft stays a draft");
assert.notEqual(byNumber.get(20).authored, true, "a review request is someone else's PR");

// The assigned copy of a PR you also wrote is kept once, and keeps `authored`.
assert.equal(json.items.filter((item) => item.number === 10).length, 1, "deduped by URL");
assert.equal(byNumber.get(10).kind, "pr");
assert.equal(byNumber.get(10).authored, true, "the first copy gains the authored flag from the later copy");

// An assigned issue is never marked authored.
assert.notEqual(byNumber.get(11).authored, true);

console.log("github-assigned route-authored.test.ts: ok");
