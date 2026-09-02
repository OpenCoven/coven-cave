// @ts-nocheck
// Broadcast fan-out mechanics (cave-g7yg6).
//
// The concurrency ceiling is the point of this module. Every /api/chat/send
// spawns an OS process and that route carries no rate limit or cap of its own,
// so an unbounded fan-out over a large selection starts that many harness
// children and model calls at once. The existing group-chat broadcast is an
// unthrottled Promise.all (src/lib/group-chat.ts:902) — the behaviour this
// deliberately does not copy.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BROADCAST_CONCURRENCY,
  failedTargets,
  normalizeBroadcastTargets,
  runBounded,
} from "./chat-broadcast.ts";
import * as broadcastModule from "./chat-broadcast.ts";

test("runBounded never exceeds its limit, and observes the real peak", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 25 }, (_, i) => i);
  const seen = await runBounded(items, 4, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    // Yield across several turns so overlap is genuinely possible — a task that
    // resolves synchronously would keep the peak at 1 and the assertion would
    // pass without testing anything.
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.equal(peak, 4, `expected the cap to be reached and not exceeded, saw ${peak}`);
  assert.deepEqual(seen, items.map((n) => n * 2), "results keep input order");
});

test("runBounded starts no more workers than there is work", async () => {
  let started = 0;
  await runBounded([1, 2], BROADCAST_CONCURRENCY, async (n) => {
    started += 1;
    await new Promise((r) => setTimeout(r, 1));
    return n;
  });
  assert.equal(started, 2, "two items must not schedule four task invocations");
});

test("runBounded refuses a limit below 1 rather than hanging", async () => {
  await assert.rejects(() => runBounded([1], 0, async (n) => n), RangeError);
});

test("a throwing task propagates instead of being mapped to a failed target", async () => {
  // Callers resolve their own per-target errors into result objects; a throw
  // here is a bug in the caller, and swallowing it would hide that.
  await assert.rejects(
    () => runBounded([1, 2], 2, async () => { throw new Error("boom"); }),
    /boom/,
  );
});

test("targets are explicit, trimmed and de-duplicated", () => {
  // De-duplication is a safety property, not tidiness: two concurrent runs on
  // one conversation collide in the stop registry, where the second overwrites
  // the first and a later session-keyed Stop reaches only the newer run.
  assert.deepEqual(
    normalizeBroadcastTargets([{ sessionId: "a" }, { sessionId: " a " }, { sessionId: "b" }]),
    [{ sessionId: "a" }, { sessionId: "b" }],
  );
  // Bare strings are accepted so a caller can pass ids directly.
  assert.deepEqual(normalizeBroadcastTargets(["a", "a", "c"]), [{ sessionId: "a" }, { sessionId: "c" }]);
  // Anything unusable yields no targets, and the route turns that into a 400
  // rather than a silent no-op broadcast.
  assert.deepEqual(normalizeBroadcastTargets(null), []);
  assert.deepEqual(normalizeBroadcastTargets([{}, "", "   ", 7]), []);
});

test("a retry targets the failures and nothing else", () => {
  // Nothing about a send is idempotent — runId is a Stop token, not a dedupe
  // key — so re-broadcasting the whole selection would double-post to every
  // target that already succeeded.
  const results = [
    { sessionId: "a", ok: true, runId: "r1" },
    { sessionId: "b", ok: false, error: "conversation not found", code: "conversation_not_found" },
    { sessionId: "c", ok: true, runId: "r2" },
    { sessionId: "d", ok: false, error: "send refused with 403", code: "send_rejected" },
  ];
  assert.deepEqual(failedTargets(results), [{ sessionId: "b" }, { sessionId: "d" }]);
});

test("broadcast copy names the selected chats and makes retry scope explicit", () => {
  assert.equal(typeof broadcastModule.chatTargetLabel, "function");
  assert.equal(typeof broadcastModule.broadcastActionLabel, "function");
  const { chatTargetLabel, broadcastActionLabel } = broadcastModule;
  assert.equal(chatTargetLabel(1), "1 chat");
  assert.equal(chatTargetLabel(3), "3 chats");
  assert.equal(broadcastActionLabel(0), "Broadcast");
  assert.equal(broadcastActionLabel(2), "Broadcast to 2 chats");
  assert.equal(broadcastActionLabel(1, true), "Retry 1 failed chat");
  assert.equal(broadcastActionLabel(3, true), "Retry 3 failed chats");
});

test("broadcast completion announcements distinguish success, partial failure, and total failure", () => {
  assert.equal(typeof broadcastModule.broadcastResultAnnouncement, "function");
  const { broadcastResultAnnouncement } = broadcastModule;
  assert.deepEqual(
    broadcastResultAnnouncement([
      { sessionId: "a", ok: true },
      { sessionId: "b", ok: true },
    ]),
    { message: "Sent to 2 chats.", level: "polite" },
  );
  assert.deepEqual(
    broadcastResultAnnouncement([
      { sessionId: "a", ok: true },
      { sessionId: "b", ok: false },
    ]),
    {
      message: "Sent to 1 chat. 1 chat failed and remains selected for retry.",
      level: "assertive",
    },
  );
  assert.deepEqual(
    broadcastResultAnnouncement([
      { sessionId: "a", ok: false },
      { sessionId: "b", ok: false },
    ]),
    {
      message: "Couldn't send to 2 chats. They remain selected for retry.",
      level: "assertive",
    },
  );
});

console.log("chat-broadcast.test.ts: ok");
