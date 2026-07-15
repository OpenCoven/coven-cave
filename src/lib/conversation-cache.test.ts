// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  cancelHoverPrefetch,
  clearConversationCache,
  hoverPrefetchConversation,
  invalidateConversation,
  prefetchConversation,
  readCachedConversation,
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
  // Expired read also evicts.
  assert.equal(readCachedConversation("s1", t0), null);
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
    assert.equal(url, "/api/chat/conversation/s1");
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
  assert.equal(calls[0][0], "/api/chat/conversation/s2");
});

// ── Wiring pins ─────────────────────────────────────────────────────────────
// The cache only helps if the surfaces stay wired: rows arm hover prefetch,
// and chat-view paints/stores/invalidates through this module.

const chatList = await readFile(new URL("../components/chat-list.tsx", import.meta.url), "utf8");
const chatRail = await readFile(new URL("../components/chat-project-sidebar.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");

test("chat-list rows arm hover prefetch and invalidate on delete", () => {
  assert.match(chatList, /onMouseEnter=\{\(\) => \{ if \(!selectMode\) hoverPrefetchConversation\(s\.id\); \}\}/);
  assert.match(chatList, /onMouseLeave=\{cancelHoverPrefetch\}/);
  assert.match(chatList, /invalidateConversation\(sessionId\)/);
});

test("thread-rail rows arm hover prefetch", () => {
  assert.match(chatRail, /onMouseEnter=\{\(\) => hoverPrefetchConversation\(session\.id\)\}/);
  assert.match(chatRail, /onMouseLeave=\{cancelHoverPrefetch\}/);
});

test("chat-view paints cached payloads, revalidates, and invalidates on send/delete", () => {
  // Cached paint goes through the same apply path as a fresh fetch…
  assert.match(chatView, /readCachedConversation\(sessionId\)/);
  assert.match(chatView, /applyConversationPayload\(cachedConversation\)/);
  // …the network fetch still runs as revalidation and refreshes the cache…
  assert.match(chatView, /storeConversation\(sessionId, json\)/);
  // …and mutations drop the entry so stale history can't be painted.
  assert.match(chatView, /invalidateConversation\(liveGeneration\.sessionId\)/);
  assert.match(chatView, /invalidateConversation\(sessionId\)/);
});
