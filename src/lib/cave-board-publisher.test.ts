import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

// Board mutators publish `board` to the event plane only after the atomic
// write lands, and a failed or no-op mutation publishes nothing (#5835).
// HOME points at a temp dir before import, and the path gate below keeps the
// real ~/.coven board untouchable.
const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-publisher-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");
const board = await import("./cave-board.ts");
assert.ok(board.BOARD_PATH.startsWith(tmpHome), `refusing to run: BOARD_PATH ${board.BOARD_PATH} is not under the temp home`);

type Seen = { topic: string; entityIds?: readonly string[]; onDisk: string[] };
function recordingPublisher(): Seen[] {
  const seen: Seen[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged(topic, entityIds) {
      // What a client refetching on this event would read right now.
      const onDisk = (JSON.parse(readFileSync(board.BOARD_PATH, "utf8")).cards as { id: string }[]).map((card) => card.id);
      seen.push({ topic, ...(entityIds ? { entityIds } : {}), onDisk });
    },
  };
  return seen;
}

afterEach(() => {
  delete globalThis.__covenCaveEventPlanePublisher;
});

test("createCard publishes the new card only after it is on disk", async () => {
  const seen = recordingPublisher();
  const card = await board.createCard({ title: "publish me" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.topic, "board");
  assert.deepEqual(seen[0]!.entityIds, [card.id]);
  assert.ok(seen[0]!.onDisk.includes(card.id), "the write landed before the event");
});

test("update, transition, restore and delete publish board changes", async () => {
  const card = await board.createCard({ title: "lifecycle" });
  const seen = recordingPublisher();
  await board.updateCard(card.id, { title: "renamed" });
  assert.deepEqual(seen.at(-1)?.entityIds, [card.id]);
  const deleted = await board.deleteCard(card.id);
  assert.equal(deleted, "deleted");
  assert.equal(seen.at(-1)?.topic, "board");
  assert.equal(seen.at(-1)?.entityIds, undefined, "a delete invalidates the whole board");
  assert.ok(!seen.at(-1)!.onDisk.includes(card.id));
  const restored = await board.restoreCards([{ ...card, title: "back" }]);
  assert.deepEqual(restored.restored, [card.id]);
  assert.deepEqual(seen.at(-1)?.entityIds, [card.id]);
});

test("failed and no-op board mutations publish nothing", async () => {
  const seen = recordingPublisher();
  assert.equal(await board.updateCard("missing-card", { title: "x" }), null);
  await board.restoreCards([]);
  assert.equal(await board.unlinkSessionFromCards("no-such-session"), 0);
  assert.deepEqual(seen, []);
});

test("a missing or disabled event plane never fails the board write", async () => {
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: () => { throw new Error("broker down"); },
  };
  const card = await board.createCard({ title: "still saved" });
  assert.ok((await board.loadBoard()).cards.some((c) => c.id === card.id));
  delete globalThis.__covenCaveEventPlanePublisher;
  const other = await board.createCard({ title: "no plane at all" });
  assert.ok((await board.loadBoard()).cards.some((c) => c.id === other.id));
});
