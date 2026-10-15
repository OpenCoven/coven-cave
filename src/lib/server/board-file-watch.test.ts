import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The board file watch publishes `board` for writes from any process (#5858).
// It runs against a real temp Cave home with real fs.watch, never ~/.coven.
const home = mkdtempSync(path.join(tmpdir(), "cave-board-watch-"));
process.env.COVEN_CAVE_HOME = home;
const { boardSourceFile, startBoardFileWatch } = await import("./board-file-watch.ts");

test("the watched file is the board in the Cave home", () => {
  assert.equal(boardSourceFile(), path.join(home, "board.json"));
});

test("an outside write to board.json publishes one board invalidation", async () => {
  const seen: string[] = [];
  globalThis.__covenCaveEventPlanePublisher = { enabled: true, markResourceChanged: (topic) => seen.push(topic) };
  const watch = startBoardFileWatch();
  try {
    assert.deepEqual(watch.watchedDirectories(), [home]);
    writeFileSync(path.join(home, "board.json"), JSON.stringify({ cards: [] }));
    writeFileSync(path.join(home, "board.json"), JSON.stringify({ cards: [] }));
    writeFileSync(path.join(home, "unrelated.json"), "{}");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(seen, ["board"], "coalesced, and unrelated files ignored");
  } finally {
    watch.stop();
    delete globalThis.__covenCaveEventPlanePublisher;
    rmSync(home, { recursive: true, force: true });
  }
});
