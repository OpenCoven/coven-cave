import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

// Session changes publish `sessions` to the event plane, after the write and
// after the shared sessions-list cache is cleared, so a client refreshing on
// the event never reads the stale snapshot (#5835).
const home = await mkdtemp(path.join(tmpdir(), "cave-sessions-publisher-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
const { saveConversation, deleteConversation, loadConversation } = await import("../cave-conversations.ts");
const cache = await import("./sessions-list-cache.ts");

const conversation = (sessionId: string) => ({
  sessionId,
  familiarId: "sage",
  harness: "claude",
  title: "Publisher test",
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:01.000Z",
  turns: [],
});

function recording(order: string[] = []) {
  const seen: { topic: string; entityIds?: readonly string[] }[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged(topic, entityIds) {
      order.push(`publish:${topic}`);
      seen.push({ topic, ...(entityIds ? { entityIds } : {}) });
    },
  };
  return seen;
}

afterEach(() => {
  delete globalThis.__covenCaveEventPlanePublisher;
});

test("a conversation save clears the list cache before it publishes", async () => {
  const order: string[] = [];
  const clear = cache.sessionsListCache.clear.bind(cache.sessionsListCache);
  cache.sessionsListCache.clear = () => {
    order.push("cache:clear");
    clear();
  };
  try {
    recording(order);
    await saveConversation(conversation("session-order") as never);
    assert.deepEqual(order, ["cache:clear", "publish:sessions"]);
  } finally {
    cache.sessionsListCache.clear = clear;
  }
});

test("conversation save and delete publish the session after persistence", async () => {
  const seen = recording();
  await saveConversation(conversation("session-1") as never);
  assert.ok(await loadConversation("session-1"), "saved before the event");
  assert.equal(await deleteConversation("session-1"), true);
  assert.deepEqual(seen, [
    { topic: "sessions", entityIds: ["session-1"] },
    { topic: "sessions", entityIds: ["session-1"] },
  ]);
});

test("deleting a conversation that doesn't exist publishes nothing", async () => {
  const seen = recording();
  assert.equal(await deleteConversation("never-existed"), false);
  assert.deepEqual(seen, []);
});

test("other session mutations publish a topic-wide invalidation", () => {
  const seen = recording();
  cache.invalidateSessionsListCache();
  assert.deepEqual(seen, [{ topic: "sessions" }]);
});
