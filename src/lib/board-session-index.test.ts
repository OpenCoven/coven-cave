// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated Cave home before any store module loads (paths resolve at import).
const home = await mkdtemp(path.join(tmpdir(), "board-session-index-"));
const previous = { HOME: process.env.HOME, COVEN_HOME: process.env.COVEN_HOME };
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");

try {
  const { createCard } = await import("./cave-board.ts");
  const { boardCardsForSession, clearBoardSessionIndex } = await import("./board-session-index.ts");
  const { linkedContextForSession } = await import("./chat-linked-context.ts");
  const { taskCardForSession } = await import("./task-chat-context.ts");
  clearBoardSessionIndex();

  assert.deepEqual(await boardCardsForSession("s-1"), [], "an empty board links nothing");

  const first = await createCard({ title: "Ship the index", sessionId: "s-1" });
  await createCard({ title: "Unrelated", sessionId: "s-2" });
  const linked = await boardCardsForSession("s-1");
  assert.deepEqual(linked.map((card) => card.id), [first.id], "a board write is visible immediately");

  // Unchanged board: the same cached array comes back, no reload.
  assert.equal(await boardCardsForSession("s-1"), linked, "an unchanged board is not reloaded");

  const second = await createCard({ title: "Follow-up", sessionId: "s-1" });
  const relinked = await boardCardsForSession("s-1");
  assert.deepEqual(relinked.map((card) => card.id), [first.id, second.id], "board order is preserved");

  const context = await linkedContextForSession("s-1");
  assert.deepEqual(context.tasks.map((task) => task.title), ["Ship the index", "Follow-up"]);
  assert.equal(await linkedContextForSession("nobody"), null);

  // taskCardForSession hands out a copy of the first linked card.
  const task = await taskCardForSession("s-1");
  assert.equal(task.id, first.id);
  task.title = "mutated by a caller";
  assert.equal((await boardCardsForSession("s-1"))[0].title, "Ship the index", "callers can't poison the index");
} finally {
  if (previous.HOME === undefined) delete process.env.HOME; else process.env.HOME = previous.HOME;
  if (previous.COVEN_HOME === undefined) delete process.env.COVEN_HOME; else process.env.COVEN_HOME = previous.COVEN_HOME;
  await rm(home, { recursive: true, force: true });
}
console.log("board-session-index.test.ts: ok");
