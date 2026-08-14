// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), ".test-tmp", `cave-board-deterministic-id-${crypto.randomUUID()}`);
await mkdir(root, { recursive: true });
process.env.HOME = root;
process.env.COVEN_HOME = path.join(root, ".coven");

const board = await import("./cave-board.ts");

assert.ok(
  board.BOARD_PATH.startsWith(root),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the test root`,
);

const effectId = "11111111-2222-4333-8444-555555555555";
const first = await board.createCard({
  id: effectId,
  title: "Ship the deterministic board card",
});
assert.equal(first.id, effectId, "the board must honor a supplied deterministic id");

const replay = await board.createCard({
  id: effectId,
  title: "A later retry must reconcile the same card",
});
assert.equal(replay.id, effectId, "retries reconcile to the original card id");
assert.equal(replay.title, first.title, "retries return the existing card instead of replacing it");

const stored = (await board.loadBoard()).cards.filter((card) => card.id === effectId);
assert.equal(stored.length, 1, "only one card may exist for a deterministic effect id");

await rm(root, { recursive: true, force: true });
console.log("cave-board-deterministic-id.test.ts: ok");
