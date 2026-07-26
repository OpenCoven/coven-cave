// @ts-nocheck
import assert from "node:assert/strict";
import { githubItemMatchesQuery } from "./github-search.ts";

const item = (over = {}) => ({
  kind: "pr", id: "1", title: "Fix auth token refresh", repo: "OpenCoven/coven-cave",
  number: 1832, url: "", state: "open", updatedAt: "", ...over,
});

// ── empty query matches everything ──
assert.equal(githubItemMatchesQuery(item(), ""), true);
assert.equal(githubItemMatchesQuery(item(), "   "), true);

// ── title / repo / number ──
assert.equal(githubItemMatchesQuery(item(), "auth"), true, "matches title");
assert.equal(githubItemMatchesQuery(item(), "coven-cave"), true, "matches repo");
assert.equal(githubItemMatchesQuery(item(), "1832"), true, "matches number");
assert.equal(githubItemMatchesQuery(item(), "#1832"), true, "matches #number");

// ── case-insensitive ──
assert.equal(githubItemMatchesQuery(item(), "AUTH"), true);

// ── multi-term AND (each term must appear) ──
assert.equal(githubItemMatchesQuery(item(), "auth refresh"), true, "all terms present");
assert.equal(githubItemMatchesQuery(item(), "auth payment"), false, "one term missing → no match");

// ── no match ──
assert.equal(githubItemMatchesQuery(item(), "deploy"), false);

// ── missing number doesn't crash ──
assert.equal(githubItemMatchesQuery(item({ number: undefined }), "auth"), true);

console.log("github-search.test.ts: ok");
