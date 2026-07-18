// @ts-nocheck
/**
 * Tests for src/lib/changes-summary-fetch.ts (cave-v8hh): the shared, deduped
 * gate in front of the bare `/api/changes?projectRoot=` summary GET.
 *
 * Several chat-surface subscribers poll the same root's summary on a 5s
 * cadence (composer git chip, stage header, code-rail badge, Changes panel);
 * this gate collapses each window onto one real request. Covers:
 *  1. concurrent callers for one root share a single fetch
 *  2. within the 4s TTL a later caller reuses the cached response (no fetch)
 *  3. past the TTL the next caller fetches fresh
 *  4. force:true bypasses the cached response
 *  5. roots are cached independently
 *  6. a rejected fetch is not cached — the next call retries
 *  7. the request shape: bare summary URL + cache:no-store, result carries
 *     httpOk/status/json through
 */

import assert from "node:assert/strict";
import {
  fetchChangesSummary,
  resetChangesSummaryCacheForTests,
} from "./changes-summary-fetch.ts";

const calls = [];
let responder = null;

function stubFetch() {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (responder) return responder(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, repo: true, files: [], branch: "main", worktree: null }),
    };
  };
}

function reset() {
  calls.length = 0;
  responder = null;
  resetChangesSummaryCacheForTests();
}

const realFetch = globalThis.fetch;
stubFetch();

try {
  // ── 1. concurrent callers share one fetch ─────────────────────────────────
  {
    reset();
    let release;
    const gate = new Promise((r) => { release = r; });
    responder = async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ ok: true, files: [1, 2] }) };
    };
    const a = fetchChangesSummary("/repo");
    const b = fetchChangesSummary("/repo");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(calls.length, 1, "concurrent subscribers must share one request");
    assert.deepEqual(ra.json.files, [1, 2]);
    assert.deepEqual(rb.json.files, [1, 2]);
  }

  // ── 2. within the TTL a later caller reuses the response ──────────────────
  {
    reset();
    await fetchChangesSummary("/repo");
    const again = await fetchChangesSummary("/repo");
    assert.equal(calls.length, 1, "a caller inside the TTL must not refetch");
    assert.equal(again.httpOk, true);
  }

  // ── 3. past the TTL the next caller fetches fresh ──────────────────────────
  {
    reset();
    await fetchChangesSummary("/repo");
    await new Promise((r) => setTimeout(r, 4100));
    await fetchChangesSummary("/repo");
    assert.equal(calls.length, 2, "past the 4s TTL the summary must be refetched");
  }

  // ── 4. force bypasses the cached response ───────────────────────────────────
  {
    reset();
    const first = await fetchChangesSummary("/repo");
    assert.equal(first.httpOk, true);
    await fetchChangesSummary("/repo", { force: true });
    assert.equal(calls.length, 2, "force must drop the cached entry and refetch");
  }

  // ── 5. roots are cached independently ───────────────────────────────────────
  {
    reset();
    await fetchChangesSummary("/repo-a");
    await fetchChangesSummary("/repo-b");
    assert.equal(calls.length, 2, "different roots must not share cache entries");
    assert.match(calls[0].url, /projectRoot=%2Frepo-a/);
    assert.match(calls[1].url, /projectRoot=%2Frepo-b/);
  }

  // ── 6. a rejected fetch is not cached ───────────────────────────────────────
  {
    reset();
    responder = async () => { throw new Error("network down"); };
    await assert.rejects(fetchChangesSummary("/repo"), /network down/);
    responder = null;
    const recovered = await fetchChangesSummary("/repo");
    assert.equal(calls.length, 2, "a failure must not be cached — the next call retries");
    assert.equal(recovered.httpOk, true);
  }

  // ── 7. request shape + result passthrough ───────────────────────────────────
  {
    reset();
    responder = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: "boom" }),
    });
    const result = await fetchChangesSummary("/some root/with spaces");
    assert.equal(
      calls[0].url,
      `/api/changes?projectRoot=${encodeURIComponent("/some root/with spaces")}`,
      "the gate must hit the bare summary URL (no branches/checkpoints/path params)",
    );
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(result.httpOk, false);
    assert.equal(result.status, 500);
    assert.equal(result.json.error, "boom");
  }

  console.log("changes-summary-fetch.test.ts: all assertions passed");
} finally {
  globalThis.fetch = realFetch;
}
