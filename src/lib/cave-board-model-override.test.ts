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
  modelOverrideHarness: " hermes-agent ",
});
assert.equal(created.modelOverride, "openai/gpt-5.6-sol", "creation trims a task model override");
assert.equal(created.modelOverrideHarness, "hermes", "creation canonicalizes the override's source harness");

const updated = await board.updateCard(created.id, {
  modelOverride: "anthropic/claude-opus-4-8",
  modelOverrideHarness: "claude-code",
});
assert.equal(updated?.modelOverride, "anthropic/claude-opus-4-8", "card patches replace the task model override");
assert.equal(updated?.modelOverrideHarness, "claude", "card patches retain the canonical source harness");

const reassigned = await board.updateCard(created.id, { familiarId: "other-familiar" });
assert.equal(reassigned?.modelOverride, null, "changing familiar clears an incompatible task model override");
assert.equal(reassigned?.modelOverrideHarness, null, "changing familiar clears the override's source harness");

const reassignedWithModel = await board.updateCard(created.id, {
  familiarId: "another-familiar",
  modelOverride: "openai/gpt-5.6-sol",
  modelOverrideHarness: "codex",
});
assert.equal(reassignedWithModel?.modelOverride, "openai/gpt-5.6-sol", "an explicit model survives an intentional combined reassignment");
assert.equal(reassignedWithModel?.modelOverrideHarness, "codex", "a combined reassignment records its runtime provenance");

const cleared = await board.updateCard(created.id, { modelOverride: null });
assert.equal(cleared?.modelOverride, null, "card patches can return to the familiar default model");
assert.equal(cleared?.modelOverrideHarness, null, "clearing a task model also clears its runtime provenance");

const oversized = await board.createCard({ title: "Bad model", modelOverride: "x".repeat(513) });
assert.equal(oversized.modelOverride, null, "oversized task model ids are rejected during persistence");

const reloaded = await board.loadBoard();
assert.equal(reloaded.cards.find((card) => card.id === created.id)?.modelOverride, null, "cleared override persists");

await rm(tmpHome, { recursive: true, force: true });

console.log("cave-board-model-override.test.ts OK");
