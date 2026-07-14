// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CACHE_ENTRIES,
  __resetAuthedImageCacheForTests,
  loadAuthedObjectUrl,
  readCachedAuthedImageUrl,
  retainAuthedImage,
  seedAuthedImageState,
} from "./authed-image.ts";

// Behavioral coverage for the shared object-URL cache (cave-wnhh): the loader
// and cache are pure JS with injectable `fetch` / `URL` statics, so exercise
// them for real — eviction, recency, refcounts, dedupe, retry — instead of
// pinning source regexes. (Hook↔React wiring stays source-pinned in
// authed-image.test.ts; there is no DOM harness in this suite.)

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Stub `fetch` + the object-URL statics for one test.
 * - `failFor`: srcs that respond 404.
 * - `gates`: src → deferred; the fetch for that src stalls until resolved.
 * Restores everything (and resets the shared cache) when the test ends.
 */
function stubEnv(t, { failFor = new Set(), gates = new Map() } = {}) {
  const fetchCalls = [];
  const revoked = [];
  let counter = 0;
  const madeBy = new Map(); // src → object URL it resolved to

  const origFetch = globalThis.fetch;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;

  globalThis.fetch = async (src) => {
    fetchCalls.push(src);
    const gate = gates.get(src);
    if (gate) await gate.promise;
    if (failFor.has(src)) return { ok: false, status: 404 };
    return { ok: true, blob: async () => ({ src }) };
  };
  URL.createObjectURL = (blob) => {
    const url = `blob:mock-${++counter}`;
    if (blob && blob.src) madeBy.set(blob.src, url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };

  __resetAuthedImageCacheForTests();
  t.after(() => {
    __resetAuthedImageCacheForTests(); // revokes via stubs, then restore
    globalThis.fetch = origFetch;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  return { fetchCalls, revoked, madeBy };
}

// --- request dedupe ----------------------------------------------------------

test("identical srcs share one in-flight fetch and resolve to one object URL", async (t) => {
  const { fetchCalls } = stubEnv(t);

  const [a, b] = await Promise.all([
    loadAuthedObjectUrl("/api/familiars/x/avatar"),
    loadAuthedObjectUrl("/api/familiars/x/avatar"),
  ]);
  const c = await loadAuthedObjectUrl("/api/familiars/x/avatar");

  assert.equal(fetchCalls.length, 1, "N concurrent + repeat loads = 1 fetch");
  assert.ok(a && a.startsWith("blob:"), "resolves to an object URL");
  assert.equal(a, b, "concurrent loads share the blob URL");
  assert.equal(a, c, "later loads reuse the cached blob URL");
});

// --- error path enables retry --------------------------------------------------

test("a failed fetch resolves null, is not cached, and a later load retries", async (t) => {
  const failFor = new Set(["/api/familiars/x/avatar"]);
  const { fetchCalls } = stubEnv(t, { failFor });

  assert.equal(await loadAuthedObjectUrl("/api/familiars/x/avatar"), null, "404 → null");
  assert.equal(
    readCachedAuthedImageUrl("/api/familiars/x/avatar"),
    null,
    "failure is not cached",
  );

  failFor.clear(); // daemon came back
  const url = await loadAuthedObjectUrl("/api/familiars/x/avatar");
  assert.equal(fetchCalls.length, 2, "second load re-fetches");
  assert.ok(url && url.startsWith("blob:"), "retry succeeds");
});

// --- eviction revokes exactly the evicted URL ---------------------------------

test("filling past the cap evicts and revokes exactly the oldest resolved entry", async (t) => {
  const { revoked, madeBy } = stubEnv(t);

  const first = await loadAuthedObjectUrl("/api/avatar/first");
  for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
    await loadAuthedObjectUrl(`/api/avatar/filler-${i}`);
  }

  assert.deepEqual(revoked, [first], "exactly the oldest URL is revoked, nothing else");
  assert.equal(readCachedAuthedImageUrl("/api/avatar/first"), null, "evicted entry is gone");
  assert.equal(
    readCachedAuthedImageUrl(`/api/avatar/filler-${MAX_CACHE_ENTRIES}`),
    madeBy.get(`/api/avatar/filler-${MAX_CACHE_ENTRIES}`),
    "surviving entries stay readable",
  );
});

// --- cave-fea6: reads refresh LRU recency --------------------------------------

test("a hook-style cache read refreshes recency so the still-rendered image is not the eviction victim", async (t) => {
  const { revoked, madeBy } = stubEnv(t);

  const first = await loadAuthedObjectUrl("/api/avatar/first");
  for (let i = 1; i < MAX_CACHE_ENTRIES; i++) {
    await loadAuthedObjectUrl(`/api/avatar/filler-${i}`);
  }
  // Cache is exactly at the cap. A component re-render reads `first` (the exact
  // read both hook paths perform) — that must make it the most recent entry.
  assert.equal(readCachedAuthedImageUrl("/api/avatar/first"), first, "read hits");

  await loadAuthedObjectUrl("/api/avatar/one-more");

  assert.equal(
    readCachedAuthedImageUrl("/api/avatar/first"),
    first,
    "recently-read entry survives eviction",
  );
  assert.deepEqual(
    revoked,
    [madeBy.get("/api/avatar/filler-1")],
    "the true least-recently-used entry is evicted instead",
  );
});

// --- cave-fea6: live consumers are refcounted ----------------------------------

test("a retained (mounted) entry is never evicted-and-revoked; releasing makes it evictable", async (t) => {
  const { revoked, madeBy } = stubEnv(t);

  const first = await loadAuthedObjectUrl("/api/avatar/first");
  const release = retainAuthedImage("/api/avatar/first");

  // Push far past the cap without ever touching `first` again — a mounted
  // component that never re-renders must still keep its URL alive.
  for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
    await loadAuthedObjectUrl(`/api/avatar/filler-${i}`);
  }
  assert.ok(!revoked.includes(first), "in-use URL is never revoked");
  assert.equal(revoked[0], madeBy.get("/api/avatar/filler-1"), "eviction skips to unretained entries");
  assert.equal(readCachedAuthedImageUrl("/api/avatar/first"), first, "in-use entry stays cached");

  release();
  release(); // double-release must not double-decrement

  // Once released (and not re-read), it ages out like anything else.
  for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
    await loadAuthedObjectUrl(`/api/avatar/late-${i}`);
  }
  assert.ok(revoked.includes(first), "released entry becomes evictable again");
});

// --- cave-fea6: success-path eviction must not kill the URL it hands out -------

test("an entry resolving while the cache is over-cap with in-flight loads is not its own eviction victim", async (t) => {
  const gates = new Map();
  gates.set("/api/avatar/first", deferred());
  for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) gates.set(`/api/avatar/inflight-${i}`, deferred());
  const { revoked } = stubEnv(t, { gates });

  // `first` starts, then the cache floods past the cap with in-flight entries
  // (in-flight entries are exempt from eviction, so the map exceeds the cap).
  const firstPromise = loadAuthedObjectUrl("/api/avatar/first");
  const rest = [];
  for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
    rest.push(loadAuthedObjectUrl(`/api/avatar/inflight-${i}`));
  }

  // `first` resolves while it is the ONLY entry holding an object URL. The
  // success-path eviction pass must not revoke the URL it is about to return.
  gates.get("/api/avatar/first").resolve();
  const first = await firstPromise;

  assert.ok(first && first.startsWith("blob:"), "resolves to an object URL");
  assert.deepEqual(revoked, [], "the just-resolved URL is not revoked");
  assert.equal(
    readCachedAuthedImageUrl("/api/avatar/first"),
    first,
    "the just-resolved entry is still cached",
  );

  for (const [, gate] of gates) gate.resolve();
  await Promise.all(rest);
});

// --- cave-x63e: state seeding for a (possibly new) src --------------------------

test("seedAuthedImageState reports loading/ready/idle for the src it was asked about", async (t) => {
  stubEnv(t);

  assert.deepEqual(seedAuthedImageState(null), { url: null, status: "idle" }, "null → idle");
  assert.deepEqual(
    seedAuthedImageState("data:image/png;base64,AAAA"),
    { url: null, status: "idle" },
    "passthrough src → idle (the hook returns it synchronously as ready)",
  );
  assert.deepEqual(
    seedAuthedImageState("/api/familiars/x/avatar"),
    { url: null, status: "loading" },
    "un-cached authed src → loading, never a stale error/ready from a previous src",
  );

  const url = await loadAuthedObjectUrl("/api/familiars/x/avatar");
  assert.deepEqual(
    seedAuthedImageState("/api/familiars/x/avatar"),
    { url, status: "ready" },
    "cached authed src → ready synchronously (no fallback flash)",
  );
});
