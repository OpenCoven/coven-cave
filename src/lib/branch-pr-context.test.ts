// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBranchPrCache, createPrUrlCache, parseBranchPr } from "./branch-pr-context.ts";

const ghJson = (over = {}) =>
  JSON.stringify({
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "MERGED",
    isDraft: false,
    ...over,
  });

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("parseBranchPr normalizes gh output (repo from url, state lowercased)", () => {
  const pr = parseBranchPr(ghJson(), "feat/x");
  assert.deepEqual(pr, {
    repo: "OpenCoven/coven-cave",
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "merged",
    branch: "feat/x",
    draft: false,
  });
});

test("parseBranchPr rejects junk", () => {
  assert.equal(parseBranchPr("not json", "b"), null);
  assert.equal(parseBranchPr(JSON.stringify({ number: 1, url: "https://example.com" }), "b"), null);
  assert.equal(parseBranchPr(JSON.stringify({ url: "https://github.com/o/r/pull/1" }), "b"), null);
});

test("parseBranchPr accepts the REST list shape (html_url + draft, head-filtered)", () => {
  const restList = JSON.stringify([
    {
      number: 42,
      html_url: "https://github.com/OpenCoven/coven-cave/pull/42",
      state: "open",
      draft: true,
    },
  ]);
  const pr = parseBranchPr(restList, "feat/x");
  assert.deepEqual(pr, {
    repo: "OpenCoven/coven-cave",
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "open",
    branch: "feat/x",
    draft: true,
  });
});

test("parseBranchPr accepts a single REST object (URL-keyed lookup)", () => {
  const restOne = JSON.stringify({
    number: 7,
    html_url: "https://github.com/o/r/pull/7",
    state: "CLOSED",
    draft: false,
  });
  const pr = parseBranchPr(restOne);
  assert.deepEqual(pr, {
    repo: "o/r",
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "closed",
    draft: false,
  });
});

test("parseBranchPr returns null for an empty REST list (no PR for branch)", () => {
  assert.equal(parseBranchPr("[]", "main"), null);
});

// ── Merged detection: REST reports merged PRs as state "closed" ──
// (merged-ness lives in `merged_at` on list/single and `merged` on single).
// Without the derivation, merged PRs badge as red "closed" and the merged-chat
// auto-archive sweep (`state === "merged"`) never fires.

test("REST list shape: closed + merged_at reads as merged", () => {
  const restList = JSON.stringify([
    {
      number: 42,
      html_url: "https://github.com/OpenCoven/coven-cave/pull/42",
      state: "closed",
      draft: false,
      merged_at: "2026-08-20T12:00:00Z",
    },
  ]);
  assert.equal(parseBranchPr(restList, "feat/x")?.state, "merged");
});

test("REST single shape: merged boolean reads as merged", () => {
  const restOne = JSON.stringify({
    number: 7,
    html_url: "https://github.com/o/r/pull/7",
    state: "closed",
    merged: true,
    merged_at: null,
  });
  assert.equal(parseBranchPr(restOne)?.state, "merged");
});

test("closed without merged_at stays closed (rejected PR, not merged)", () => {
  const restOne = JSON.stringify({
    number: 8,
    html_url: "https://github.com/o/r/pull/8",
    state: "closed",
    merged: false,
    merged_at: null,
  });
  assert.equal(parseBranchPr(restOne)?.state, "closed");
});

test("first read misses but schedules a background fetch; next read serves it", async () => {
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      return ghJson();
    },
  });
  assert.equal(cache.get("/repo", "feat/x"), undefined);
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "merged");
  assert.equal(calls, 1, "fresh entry is served from memory, no second fetch");
});

test("failures negative-cache as null (no gh hammering)", async () => {
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      throw new Error("no pull requests found");
    },
  });
  cache.get("/repo", "main");
  await tick();
  assert.equal(cache.get("/repo", "main"), null);
  await tick();
  assert.equal(calls, 1);
});

test("expired entries keep serving stale while revalidating", async () => {
  let now = 0;
  let calls = 0;
  const cache = createBranchPrCache({
    ttlMs: 1000,
    now: () => now,
    runner: async () => {
      calls += 1;
      return ghJson({ state: calls === 1 ? "OPEN" : "MERGED" });
    },
  });
  cache.get("/repo", "feat/x");
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "open");
  now = 2000; // past TTL — stale value still served, refresh kicks off
  assert.equal(cache.get("/repo", "feat/x")?.state, "open");
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "merged");
});

test("concurrent refreshes are capped", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createBranchPrCache({
    maxConcurrent: 2,
    runner: async () => {
      started += 1;
      await gate;
      return ghJson();
    },
  });
  cache.get("/a", "b1");
  cache.get("/a", "b2");
  cache.get("/a", "b3"); // over the cap — skipped this poll
  assert.equal(started, 2);
  release();
  await tick();
});

// #5619: the composer chip must have an answer, so resolve() awaits a miss.
test("resolve awaits one shared lookup on a miss, then answers from memory", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      await gate;
      return ghJson({ state: "OPEN" });
    },
  });
  const first = cache.resolve("/repo", "feat/x");
  const second = cache.resolve("/repo", "feat/x");
  assert.equal(cache.get("/repo", "feat/x"), undefined, "the list poll joins the same lookup");
  release();
  assert.equal((await first)?.state, "open");
  assert.equal((await second)?.state, "open");
  assert.equal((await cache.resolve("/repo", "feat/x"))?.number, 42);
  assert.equal(calls, 1);
});

test("resolve serves a stale entry at once and refreshes it behind", async () => {
  let now = 0;
  let calls = 0;
  const cache = createBranchPrCache({
    ttlMs: 1000,
    now: () => now,
    runner: async () => {
      calls += 1;
      return ghJson({ state: calls === 1 ? "OPEN" : "MERGED" });
    },
  });
  assert.equal((await cache.resolve("/repo", "feat/x"))?.state, "open");
  now = 2000;
  assert.equal((await cache.resolve("/repo", "feat/x"))?.state, "open", "stale answer, no wait");
  await tick();
  assert.equal((await cache.resolve("/repo", "feat/x"))?.state, "merged");
});

test("resolve negative-caches a failed lookup as null", async () => {
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      throw new Error("gh missing");
    },
  });
  assert.equal(await cache.resolve("/repo", "main"), null);
  assert.equal(await cache.resolve("/repo", "main"), null);
  assert.equal(calls, 1);
});

test("resolve is not refused by the background cap", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createBranchPrCache({
    maxConcurrent: 1,
    runner: async (_root, branch) => {
      if (branch === "busy") await gate;
      return ghJson();
    },
  });
  cache.get("/a", "busy");
  assert.equal((await cache.resolve("/a", "wanted"))?.number, 42, "a user-facing ask still gets its answer");
  release();
  await tick();
});

// ── URL-keyed cache (transcript-derived attribution, cave-u9wl) ──

test("parseBranchPr without a branch omits the field", () => {
  const pr = parseBranchPr(ghJson());
  assert.equal(pr.branch, undefined);
  assert.equal(pr.repo, "OpenCoven/coven-cave");
});

test("prUrlCache: first read misses, background fetch keyed on the URL", async () => {
  const urls = [];
  const cache = createPrUrlCache({
    runner: async (url) => {
      urls.push(url);
      return ghJson();
    },
  });
  const url = "https://github.com/OpenCoven/coven-cave/pull/42";
  assert.equal(cache.get(url), undefined);
  await tick();
  const pr = cache.get(url);
  assert.equal(pr?.state, "merged");
  assert.equal(pr?.branch, undefined, "URL lookups carry no branch");
  assert.deepEqual(urls, [url]);
});

test("prUrlCache: failures negative-cache as null", async () => {
  let calls = 0;
  const cache = createPrUrlCache({
    runner: async () => {
      calls += 1;
      throw new Error("gh: not found");
    },
  });
  cache.get("https://github.com/o/r/pull/1");
  await tick();
  assert.equal(cache.get("https://github.com/o/r/pull/1"), null);
  await tick();
  assert.equal(calls, 1, "negative entry served from memory within TTL");
});

// ── #5795: the desk's own actions, and a reused branch ──

test("invalidate drops (root, branch), and entries keyed by a folder inside root", async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "branch-pr-invalidate-")));
  mkdirSync(path.join(root, "app"));
  let open = false;
  const cache = createBranchPrCache({ runner: async () => (open ? JSON.stringify([{ number: 9, html_url: "https://github.com/o/r/pull/9", state: "open" }]) : "[]") });
  try {
    assert.equal(await cache.resolve(root, "cave/x"), null);
    assert.equal(await cache.resolve(path.join(root, "app"), "cave/x"), null, "the sessions list keys by the chat's folder");
    assert.equal(await cache.resolve(root, "other"), null);
    open = true; // Create PR opened it
    cache.invalidate(root, "cave/x");
    assert.equal(cache.get(path.join(root, "app"), "cave/x"), undefined, "a subfolder's entry went too");
    assert.equal((await cache.resolve(root, "cave/x"))?.number, 9, "the next read asks again");
    assert.equal(cache.get(root, "other"), null, "another branch keeps its answer");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lookup in flight when invalidated never lands", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return "[]"; // read before the PR was opened
      }
      return JSON.stringify([{ number: 5, html_url: "https://github.com/o/r/pull/5", state: "open" }]);
    },
  });
  const stale = cache.resolve("/repo", "cave/y");
  cache.invalidate("/repo", "cave/y");
  release();
  assert.equal(await stale, null, "its own caller still gets its answer");
  assert.equal((await cache.resolve("/repo", "cave/y"))?.number, 5, "but it wasn't kept");
});

test("invalidatePullRequest drops every entry that answered with that PR", async () => {
  let state = "open";
  const cache = createBranchPrCache({
    runner: async () => JSON.stringify([{ number: 12, html_url: "https://github.com/O/R/pull/12", state, ...(state === "closed" ? { merged_at: "2026-10-01T00:00:00Z" } : {}) }]),
  });
  assert.equal((await cache.resolve("/a", "feat"))?.state, "open");
  assert.equal((await cache.resolve("/b", "feat"))?.state, "open");
  state = "closed"; // merged
  cache.invalidatePullRequest("o/r", 12);
  assert.equal(cache.get("/a", "feat"), undefined);
  assert.equal((await cache.resolve("/b", "feat"))?.state, "merged");
});

test("a merged PR is settled only while its branch hasn't moved past the merge", async () => {
  let now = 0;
  let calls = 0;
  const merged = (headSha) =>
    JSON.stringify([{ number: 3, html_url: "https://github.com/o/r/pull/3", state: "closed", merged_at: "2026-10-01T12:00:00Z", head: { sha: headSha } }]);
  const tips = {
    // Reused: a commit after the merge.
    reused: { oid: "b".repeat(40), committedAt: Date.parse("2026-10-02T09:00:00Z") },
    // Untouched since the PR's head.
    done: { oid: "a".repeat(40), committedAt: Date.parse("2026-10-01T11:00:00Z") },
  };
  const cache = createBranchPrCache({
    ttlMs: 1000,
    settledTtlMs: 60_000,
    now: () => now,
    branchTip: async (_root, branch) => tips[branch] ?? null,
    runner: async () => {
      calls += 1;
      return merged("a".repeat(40));
    },
  });
  assert.equal((await cache.resolve("/repo", "reused"))?.state, "merged");
  assert.equal((await cache.resolve("/repo", "done"))?.state, "merged");
  assert.equal(calls, 2);
  now = 2000; // past the open-PR TTL, well within the settled one
  cache.get("/repo", "reused");
  cache.get("/repo", "done");
  await tick();
  assert.equal(calls, 3, "only the reused branch is looked up again");
});
