// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatListStaleNotice,
  mergeDegradedSessionList,
  resolveChatDeepLink,
  sessionsPollIntervalMs,
  SESSIONS_POLL_MS,
} from "./chat-list-authority.ts";

const row = (id, familiarId = "nova") => ({ id, familiarId, title: id });

test("list poll backs off on consecutive failures and resets on success", () => {
  assert.equal(sessionsPollIntervalMs(0), SESSIONS_POLL_MS);
  assert.equal(sessionsPollIntervalMs(1), 8_000);
  assert.equal(sessionsPollIntervalMs(2), 16_000);
  assert.equal(sessionsPollIntervalMs(3), 30_000);
  assert.equal(sessionsPollIntervalMs(50), 30_000);
  assert.equal(sessionsPollIntervalMs(Number.NaN), SESSIONS_POLL_MS);
});

test("a degraded response keeps the previous rows it omitted", () => {
  const previous = [row("daemon-1"), row("local-1"), row("daemon-2")];
  const degraded = [{ ...row("local-1"), title: "fresh" }];
  const merged = mergeDegradedSessionList(previous, degraded);
  assert.deepEqual(merged.map((session) => session.id), ["local-1", "daemon-1", "daemon-2"]);
  assert.equal(merged[0].title, "fresh", "the degraded response's own rows win");
});

test("a degraded response with nothing to retain returns its own rows", () => {
  const degraded = [row("a")];
  assert.deepEqual(mergeDegradedSessionList([], degraded), degraded);
});

test("a listed deep-link target opens without a lookup", async () => {
  let looked = false;
  const resolution = await resolveChatDeepLink("s1", [row("s1", "sage")], async () => {
    looked = true;
    return null;
  });
  assert.deepEqual(resolution, { kind: "open", familiarId: "sage" });
  assert.equal(looked, false);
});

test("a deep-link target missing from the scoped list opens with its own familiar", async () => {
  const resolution = await resolveChatDeepLink("s2", [row("s1")], async () => ({
    ok: true,
    conversation: { familiarId: "cody" },
  }));
  assert.deepEqual(resolution, { kind: "open", familiarId: "cody" });
});

test("only a 404 treats a deep-link target as missing", async () => {
  const notFound = Object.assign(new Error("not found"), { status: 404 });
  assert.deepEqual(
    await resolveChatDeepLink("gone", [], async () => { throw notFound; }),
    { kind: "missing" },
  );
  const unavailable = Object.assign(new Error("daemon down"), { status: 503 });
  assert.deepEqual(
    await resolveChatDeepLink("s3", [], async () => { throw unavailable; }),
    { kind: "open", familiarId: null },
  );
  assert.deepEqual(
    await resolveChatDeepLink("s4", [], async () => { throw new TypeError("network"); }),
    { kind: "open", familiarId: null },
  );
});

test("a conversation without a readable familiar still opens", async () => {
  assert.deepEqual(
    await resolveChatDeepLink("s5", [], async () => ({ ok: true, conversation: null })),
    { kind: "open", familiarId: null },
  );
  assert.deepEqual(
    await resolveChatDeepLink("s6", [], async () => ({ ok: true, conversation: { familiarId: 7 } })),
    { kind: "open", familiarId: null },
  );
});

test("the stale notice shows only above existing rows", () => {
  assert.equal(chatListStaleNotice({ sessionsError: true, sessionsDegraded: false, hasRows: false }), null);
  assert.equal(
    chatListStaleNotice({ sessionsError: true, sessionsDegraded: true, hasRows: true }),
    "Couldn't refresh chats. Showing the last list.",
  );
  assert.equal(
    chatListStaleNotice({ sessionsError: false, sessionsDegraded: true, hasRows: true }),
    "Coven isn't reachable. Showing chats saved on this device.",
  );
  assert.equal(chatListStaleNotice({ sessionsError: false, sessionsDegraded: false, hasRows: true }), null);
});
