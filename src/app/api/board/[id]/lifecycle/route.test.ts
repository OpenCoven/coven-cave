import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// #6562: the Board asks for a dispatch once a task chat's first prompt lands,
// with `onlyIfReady`. The route dispatches only a ready, triaged task, decided
// inside the board lock, and returns anything else unchanged, not refused.
const testHome = await mkdtemp(path.join(tmpdir(), "cave-lifecycle-route-"));
process.env.COVEN_CAVE_HOME = testHome;
process.env.COVEN_HOME = path.join(testHome, ".coven");

try {
  const board = await import("../../../../../lib/cave-board.ts");
  const { POST } = await import("./route.ts");
  const post = async (id: string, body: unknown) => {
    const res = await POST(
      new Request(`http://127.0.0.1/api/board/${id}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: res.status, json: await res.json() as { ok: boolean; card?: { lifecycle: string; lifecycleReason?: string }; error?: string } };
  };
  const dispatchIfReady = { to: "dispatched", onlyIfReady: true, reason: "Task chat started (session s-1)" };

  const ready = await board.createCard({ title: "Ready" });
  const started = await post(ready.id, dispatchIfReady);
  assert.equal(started.status, 200);
  assert.equal(started.json.card?.lifecycle, "dispatched", "a ready task dispatches once its chat starts");
  assert.equal(started.json.card?.lifecycleReason, "Task chat started (session s-1)");
  const again = await post(ready.id, dispatchIfReady);
  assert.equal(again.status, 200, "a repeat after it already moved on is a no-op, not an invalid transition");
  assert.equal(again.json.card?.lifecycle, "dispatched");

  const inbox = await board.createCard({ title: "Untriaged", status: "inbox" });
  assert.equal((await post(inbox.id, dispatchIfReady)).json.card?.lifecycle, "queued", "an Inbox task stays put");

  const waiting = await board.createCard({
    title: "Waiting",
    dependencies: [{ id: "w", kind: "human", label: "Maintainer decision", state: "unresolved", origin: "human", createdAt: new Date().toISOString() }],
  });
  assert.equal((await post(waiting.id, dispatchIfReady)).json.card?.lifecycle, "queued", "a waiting task stays put");

  // The flag only qualifies a dispatch.
  assert.equal((await post(ready.id, { to: "running", onlyIfReady: true })).status, 400);
  assert.equal((await post(ready.id, { to: "dispatched", onlyIfReady: "yes" })).status, 400);
  // Without the flag the strict transition rules still apply.
  assert.equal((await post(ready.id, { to: "dispatched" })).status, 409, "an unguarded invalid transition is still refused");

  console.log("lifecycle route.test.ts OK");
} finally {
  await rm(testHome, { recursive: true, force: true });
}
