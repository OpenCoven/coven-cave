import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression: cave-board.json was written with a plain (non-atomic) writeFile
// and loadBoard() falls back to an empty board on any parse error. Concurrent
// mutations clobbered each other (lost updates), and a read landing mid-write
// parsed a truncated file → empty board → cards "vanished" (e.g. the task-chat
// POST 404ing on a card that exists). The fix: serialize mutations through a
// write lock and write atomically (tmp file + rename).
//
// BOARD_PATH derives from os.homedir(), which honors $HOME on POSIX. We point
// HOME at a temp dir BEFORE importing the module, then HARD-GATE on the path so
// a misconfigured run can never touch the real ~/.coven/cave-board.json.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-home-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

// SAFETY GATE — never mutate a real board.
assert.ok(
  board.BOARD_PATH.startsWith(tmpHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

// 1. Concurrent creates — no lost updates (the write lock). Without
//    serialization every create reads the same snapshot and the last save wins,
//    leaving a single card.
const N = 25;
await Promise.all(Array.from({ length: N }, (_, i) => board.createCard({ title: `card ${i}` })));
const afterCreate = await board.loadBoard();
assert.equal(afterCreate.cards.length, N, "all concurrent creates persisted (no lost updates)");
assert.equal(new Set(afterCreate.cards.map((c) => c.id)).size, N, "every card id is distinct");

// 2. The on-disk file is always complete, valid JSON — never torn.
const raw = await readFile(board.BOARD_PATH, "utf8");
assert.equal(JSON.parse(raw).cards.length, N, "persisted file parses with all cards");

// 3. No leftover temp files after atomic writes.
const dir = path.dirname(board.BOARD_PATH);
assert.ok(
  !(await readdir(dir)).some((name) => name.endsWith(".tmp")),
  "no leftover .tmp files after atomic writes",
);

// 4. Reads interleaved with a burst of writes never observe an empty board
//    (the torn-read 404). With atomic rename a reader always sees a complete
//    old-or-new file.
const targetId = afterCreate.cards[0].id;
let tornReads = 0;
await Promise.all([
  ...Array.from({ length: 60 }, (_, i) => board.updateCard(targetId, { notes: `n${i}` })),
  ...Array.from({ length: 60 }, async () => {
    const b = await board.loadBoard();
    if (b.cards.length === 0) tornReads += 1;
  }),
]);
assert.equal(tornReads, 0, "no torn reads (empty board) during concurrent writes");

// cleanup
await rm(tmpHome, { recursive: true, force: true });

console.log("ok - cave-board atomic write + write lock: no lost updates, no torn reads");
