// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getPerfMeasures, startSpan } from "./perf/marks.ts";
import {
  cancelHoverPrefetch,
  clearConversationCache,
  ConversationLoadError,
  hoverPrefetchConversation,
  invalidateConversation,
  loadConversation,
  prefetchConversation,
  readCachedConversation,
  readConversationForPaint,
  storeConversation,
} from "./conversation-cache.ts";

function payload(text: string) {
  return {
    ok: true,
    context: null,
    conversation: {
      activeLeafId: "t1",
      turns: [{ id: "t1", parentId: null, role: "user", text, createdAt: "2026-07-11T00:00:00.000Z" }],
    },
  };
}

function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return calls;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("concurrent transcript spans retain their own start time", () => {
  const originalPerformance = globalThis.performance;
  let now = 10;
  globalThis.performance = { mark() {}, now: () => now };
  try {
    const first = startSpan("chat:transcript-fetch");
    now = 20;
    const second = startSpan("chat:transcript-fetch");
    now = 50;
    assert.equal(first(), 40);
    now = 80;
    assert.equal(second(), 60);
    assert.equal(first(), null, "closing twice must not record a duplicate sample");
    assert.deepEqual(getPerfMeasures().slice(-2).map((entry) => entry.duration), [40, 60]);
  } finally {
    globalThis.performance = originalPerformance;
  }
});

test.beforeEach(() => {
  clearConversationCache();
});

test("store + read roundtrip; only ok payloads with a conversation are stored", () => {
  storeConversation("s1", payload("hello"));
  assert.equal(readCachedConversation("s1")?.conversation.turns[0].text, "hello");

  storeConversation("s2", { ok: false, conversation: payload("x").conversation });
  assert.equal(readCachedConversation("s2"), null);

  storeConversation("s3", { ok: true });
  assert.equal(readCachedConversation("s3"), null);
});

test("entries expire after the TTL", () => {
  const t0 = 1_000_000;
  storeConversation("s1", payload("hello"), t0);
  assert.ok(readCachedConversation("s1", t0 + 44_000));
  assert.equal(readCachedConversation("s1", t0 + 46_000), null);
});

// #5607: an expired entry is not fresh, but its tag revalidates it.
test("an expired entry revalidates with If-None-Match and a 304 reuses it", async () => {
  const kept = payload("kept");
  storeConversation("s1", kept, Date.now() - 60_000, '"c-v1"');
  assert.equal(readCachedConversation("s1"), null, "past the paint TTL it does not paint");
  const calls = stubFetch(async () => ({ ok: false, status: 304, json: async () => null }));
  const loaded = await loadConversation("s1");
  assert.equal(calls[0][1].headers["If-None-Match"], '"c-v1"');
  assert.equal(loaded, kept, "the same payload object, so the view sees no change");
  assert.equal(readCachedConversation("s1"), kept, "a 304 refreshes the paint window");
});

test("a reopened thread paints the kept entry past its TTL; invalidation drops it", () => {
  const t0 = 1_000_000;
  const kept = payload("kept");
  storeConversation("s1", kept, t0);
  assert.equal(readCachedConversation("s1", t0 + 60_000), null, "not fresh: prefetch still refetches");
  assert.equal(readConversationForPaint("s1", t0 + 60_000), kept, "but a reopen paints it instead of the skeleton");
  invalidateConversation("s1");
  assert.equal(readConversationForPaint("s1", t0 + 60_000), null, "a send or delete invalidation never paints stale history");
  assert.equal(readConversationForPaint("missing"), null);
});

test("a changed revision replaces the kept payload and its tag", async () => {
  storeConversation("s1", payload("old"), Date.now() - 60_000, '"c-v1"');
  stubFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ ETag: '"c-v2"' }),
    json: async () => payload("new"),
  }));
  const loaded = await loadConversation("s1");
  assert.equal(loaded.conversation.turns[0].text, "new");
  const calls = stubFetch(async () => ({ ok: false, status: 304, json: async () => null }));
  assert.equal(await loadConversation("s1"), loaded);
  assert.equal(calls[0][1].headers["If-None-Match"], '"c-v2"');
});

test("a load with nothing kept sends no If-None-Match", async () => {
  const calls = stubFetch(async () => ({ ok: true, json: async () => payload("fresh") }));
  await loadConversation("s1");
  assert.equal(calls[0][1].headers, undefined);
});

test("the offline copy is rewritten only for a new revision", async () => {
  const { offlineConversationWriteNeeded, recordOfflineConversationWrite } = await import("./conversation-cache.ts");
  const first = payload("a");
  storeConversation("s1", first, Date.now(), '"c-v1"');
  assert.equal(offlineConversationWriteNeeded("s1", first), true);
  recordOfflineConversationWrite("s1", first);
  assert.equal(offlineConversationWriteNeeded("s1", first), false, "an unchanged revision is not rewritten");
  const second = payload("b");
  storeConversation("s1", second, Date.now(), '"c-v2"');
  assert.equal(offlineConversationWriteNeeded("s1", second), true, "a new revision is");
  assert.equal(offlineConversationWriteNeeded("s1", payload("untagged")), true, "untagged payloads are always written");
  recordOfflineConversationWrite("s1", second);
  invalidateConversation("s1");
  assert.equal(offlineConversationWriteNeeded("s1", second), true, "a deleted chat's copy is never assumed present");
});

test("invalidateConversation drops a single entry", () => {
  storeConversation("s1", payload("a"));
  storeConversation("s2", payload("b"));
  invalidateConversation("s1");
  assert.equal(readCachedConversation("s1"), null);
  assert.ok(readCachedConversation("s2"));
});

test("cache is bounded: oldest entry evicted beyond the cap", () => {
  for (let i = 0; i < 25; i++) storeConversation(`s${i}`, payload(`m${i}`));
  assert.equal(readCachedConversation("s0"), null);
  assert.ok(readCachedConversation("s24"));
});

test("prefetch fetches, caches, and dedupes concurrent requests", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = stubFetch(async (url) => {
    assert.equal(url, "/api/chat/conversation/s1?toolOutputs=recent");
    await gate;
    return { ok: true, json: async () => payload("prefetched") };
  });
  const a = prefetchConversation("s1");
  const b = prefetchConversation("s1");
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(ra?.conversation.turns[0].text, "prefetched");
  assert.equal(rb, ra);
  assert.ok(readCachedConversation("s1"));
});

test("foreground loading joins an in-flight prefetch instead of fetching twice", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = stubFetch(async () => {
    await gate;
    return { ok: true, json: async () => payload("shared") };
  });

  const prefetched = prefetchConversation("s1");
  const opened = loadConversation("s1");
  release();

  const [prefetchResult, openResult] = await Promise.all([prefetched, opened]);
  assert.equal(calls.length, 1);
  assert.equal(openResult, prefetchResult);
  assert.equal(openResult?.conversation.turns[0].text, "shared");
});

test("invalidation prevents an older in-flight load from repopulating the cache", async () => {
  const releases = [];
  stubFetch(async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    releases.push(release);
    await gate;
    return { ok: true, json: async () => payload(`response-${releases.indexOf(release) + 1}`) };
  });

  const staleLoad = loadConversation("s1");
  await Promise.resolve();
  invalidateConversation("s1");
  const freshLoad = loadConversation("s1");
  await Promise.resolve();

  assert.equal(releases.length, 2, "a post-invalidation load must not join the stale request");
  releases[0]();
  await staleLoad;
  assert.equal(readCachedConversation("s1"), null, "the invalidated response must not be cached");

  releases[1]();
  await freshLoad;
  assert.equal(readCachedConversation("s1")?.conversation.turns[0].text, "response-2");
});

test("foreground loading preserves a context-only successful payload", async () => {
  const contextOnly = { ok: true, context: { task: { id: "task-1" } } };
  stubFetch(async () => ({ ok: true, json: async () => contextOnly }));
  assert.deepEqual(await loadConversation("s1"), contextOnly);
  assert.equal(readCachedConversation("s1"), null);
});

test("foreground loading preserves the response status for error handling", async () => {
  stubFetch(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ ok: false, error: "Conversation not found" }),
  }));
  await assert.rejects(
    loadConversation("missing"),
    (error) => (
      error instanceof ConversationLoadError
      && error.status === 404
      && error.message === "Conversation not found"
    ),
  );
});

test("a transient failure is retried once, quietly; a 4xx or second failure is not", async () => {
  clearConversationCache();
  let n = 0;
  let calls = stubFetch(async () => {
    n += 1;
    if (n === 1) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, headers: new Headers(), json: async () => payload("after blip") };
  });
  assert.equal((await loadConversation("blip-network")).conversation.turns[0].text, "after blip");
  assert.equal(calls.length, 2, "a dropped connection retries once");

  n = 0;
  calls = stubFetch(async () => {
    n += 1;
    return n === 1
      ? { ok: false, status: 503, json: async () => ({ ok: false, error: "restarting" }) }
      : { ok: true, status: 200, headers: new Headers(), json: async () => payload("after 503") };
  });
  assert.equal((await loadConversation("blip-503")).conversation.turns[0].text, "after 503");
  assert.equal(calls.length, 2, "a 5xx retries once");

  calls = stubFetch(async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: "not found" }) }));
  await assert.rejects(loadConversation("gone"), (error) => error instanceof ConversationLoadError && error.status === 404);
  assert.equal(calls.length, 1, "a 404 is an answer, not retried");

  calls = stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: "still down" }) }));
  await assert.rejects(loadConversation("down"), (error) => error instanceof ConversationLoadError && error.status === 500);
  assert.equal(calls.length, 2, "a second failure surfaces instead of retrying forever");
});

test("foreground loading rejects malformed successful responses", async () => {
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("invalid JSON"); },
  }));
  await assert.rejects(
    loadConversation("malformed"),
    (error) => (
      error instanceof ConversationLoadError
      && error.status === 200
      && error.message === "Conversation response was not valid JSON"
    ),
  );
});

test("prefetch resolves from a fresh cache entry without a network request", async () => {
  storeConversation("s1", payload("cached"));
  const calls = stubFetch(async () => { throw new Error("should not fetch"); });
  const result = await prefetchConversation("s1");
  assert.equal(calls.length, 0);
  assert.equal(result?.conversation.turns[0].text, "cached");
});

test("failed prefetch caches nothing and never throws", async () => {
  stubFetch(async () => ({ ok: false, json: async () => ({ ok: false }) }));
  assert.equal(await prefetchConversation("s1"), null);
  assert.equal(readCachedConversation("s1"), null);

  stubFetch(async () => { throw new Error("network down"); });
  assert.equal(await prefetchConversation("s2"), null);
  assert.equal(readCachedConversation("s2"), null);
});

test("hover prefetch fires after the intent delay; cancel disarms it", async () => {
  const calls = stubFetch(async () => ({ ok: true, json: async () => payload("hovered") }));

  hoverPrefetchConversation("s-cancelled");
  cancelHoverPrefetch();
  await sleep(150);
  assert.equal(calls.length, 0);

  hoverPrefetchConversation("s1");
  await sleep(150);
  assert.equal(calls.length, 1);
  assert.ok(readCachedConversation("s1"));
});

test("hovering another row re-arms the singleton timer onto the new session", async () => {
  const calls = stubFetch(async (url) => ({ ok: true, json: async () => payload(String(url)) }));
  hoverPrefetchConversation("s1");
  hoverPrefetchConversation("s2");
  await sleep(150);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/chat/conversation/s2?toolOutputs=recent");
});

// ── Wiring pins ─────────────────────────────────────────────────────────────
// The cache only helps if the surfaces stay wired: rows arm hover and immediate
// intent prefetch, and chat-view paints/loads/invalidates through this module.

const chatList = await readFile(new URL("../components/chat-list.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/workspace.tsx", import.meta.url), "utf8");

test("chat-list rows prefetch on hover, pointer down, and keyboard focus", () => {
  assert.match(chatList, /onMouseEnter=\{\(\) => \{ if \(!selectMode\) hoverPrefetchConversation\(s\.id\); \}\}/);
  assert.match(chatList, /onMouseLeave=\{cancelHoverPrefetch\}/);
  assert.match(chatList, /onPointerDown=\{\(\) => \{[\s\S]{0,140}?prefetchConversation\(s\.id\)/);
  assert.match(chatList, /onFocus=\{\(event\) => \{[\s\S]{0,180}?event\.target !== event\.currentTarget[\s\S]{0,180}?prefetchConversation\(s\.id\)/);
  assert.match(chatList, /onSessionsDeleted\(\[sessionId\]\)/);
});


test("chat-view paints cached payloads and shares revalidation with prefetch", () => {
  // Cached paint (fresh, or kept past its TTL while it revalidates) goes
  // through the same apply path as a fresh fetch…
  assert.match(chatView, /readConversationForPaint\(sessionId\)/);
  assert.match(chatView, /applyConversationPayload\(cachedConversation\)/);
  // …the network revalidation joins any row prefetch already in progress.
  assert.match(chatView, /loadConversation\(sessionId\)/);
  // …and mutations drop the entry so stale history can't be painted.
  assert.match(chatView, /invalidateConversation\(liveGeneration\.sessionId\)/);
  assert.match(chatView, /invalidateConversation\(sessionId\)/);
  // Confirmed deletion invalidation is centralized so list, project, header,
  // sidebar, and split-pane deletes cannot drift apart.
  assert.match(workspace, /for \(const sessionId of confirmedIds\) invalidateConversation\(sessionId\)/);
});

test("the transcript fetch is bounded and a timed-out load doesn't pin Retry (#5583)", async () => {
  clearConversationCache();
  let attempt = 0;
  const calls = stubFetch((_url, init) => {
    attempt += 1;
    assert.ok(init?.signal instanceof AbortSignal, "every transcript request carries an abort signal");
    if (attempt === 1) {
      // A stalled route: reject the way the timeout signal would.
      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    }
    return Promise.resolve(new Response(JSON.stringify(payload("after retry")), { status: 200 }));
  });
  await assert.rejects(loadConversation("timeout-1"), (error) => error?.name === "TimeoutError");
  const retried = await loadConversation("timeout-1");
  assert.equal(retried.conversation.turns[0].text, "after retry", "Retry starts a fresh request");
  assert.equal(calls.length, 2);
});
