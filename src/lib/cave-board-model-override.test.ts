import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-model-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

const created = await board.createCard({
  title: "Use a task model",
  modelOverride: "  openai/gpt-5.6-sol  ",
});
assert.equal(created.modelOverride, "openai/gpt-5.6-sol", "creation trims a task model override");

const updated = await board.updateCard(created.id, { modelOverride: "anthropic/claude-opus-4-8" });
assert.equal(updated?.modelOverride, "anthropic/claude-opus-4-8", "card patches replace the task model override");

const cleared = await board.updateCard(created.id, { modelOverride: null });
assert.equal(cleared?.modelOverride, null, "card patches can return to the familiar default model");

const oversized = await board.createCard({ title: "Bad model", modelOverride: "x".repeat(513) });
assert.equal(oversized.modelOverride, null, "oversized task model ids are rejected during persistence");

const reloaded = await board.loadBoard();
assert.equal(reloaded.cards.find((card) => card.id === created.id)?.modelOverride, null, "cleared override persists");

await rm(tmpHome, { recursive: true, force: true });

console.log("cave-board-model-override.test.ts OK");
