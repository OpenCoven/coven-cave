// @ts-nocheck
// #5617: the usage meter skips conversations older than the period and
// remembers each conversation's usage facts until it is written again.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "chat-usage-turns-"));
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_HOME = path.join(home, "coven");
const { CONV_DIR, clearConversationListMetadataCache } = await import("../cave-conversations.ts");
const { usageTurnsForPlan, clearChatUsageFacts } = await import("./chat-usage-turns.ts");
mkdirSync(CONV_DIR, { recursive: true });

const period = { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" };
function write(id, { familiarId = "cody", updatedAt, turns, model }) {
  writeFileSync(path.join(CONV_DIR, `${id}.json`), JSON.stringify({
    sessionId: id, familiarId, harness: "claude", title: id, model,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt, turns,
  }));
}
const reply = (id, createdAt, input, model) => ({
  id, role: "assistant", text: "ok", createdAt,
  usage: { inputTokens: input, outputTokens: 1 },
  ...(model ? { responseMetadata: { familiarId: "cody", harness: "claude", model, runtime: "local:x" } } : {}),
});
const total = (turns) => turns.reduce((sum, turn) => sum + (turn.usage?.inputTokens ?? 0), 0);
const ask = (model = "anthropic/claude-opus-5-5") => usageTurnsForPlan({ familiarId: "cody", model, ...period });

write("current", {
  updatedAt: "2026-09-20T00:00:00.000Z",
  turns: [reply("a", "2026-09-10T00:00:00.000Z", 10, "anthropic/claude-opus-5-5"), reply("b", "2026-08-31T23:00:00.000Z", 100, "anthropic/claude-opus-5-5")],
});
write("conversation-model", {
  updatedAt: "2026-09-21T00:00:00.000Z", model: "claude-opus-5-5",
  turns: [reply("c", "2026-09-11T00:00:00.000Z", 20)],
});
write("other-model", {
  updatedAt: "2026-09-22T00:00:00.000Z",
  turns: [reply("d", "2026-09-12T00:00:00.000Z", 40, "openai/gpt-5.5")],
});
write("other-familiar", {
  familiarId: "nova", updatedAt: "2026-09-22T00:00:00.000Z",
  turns: [reply("e", "2026-09-12T00:00:00.000Z", 80, "anthropic/claude-opus-5-5")],
});
// Last written before the period: skipped without being read. Its turn claims
// an in-period time only to prove the skip is what keeps it out.
write("stale", {
  updatedAt: "2026-08-15T00:00:00.000Z",
  turns: [reply("f", "2026-09-05T00:00:00.000Z", 1000, "anthropic/claude-opus-5-5")],
});

assert.equal(total(await ask()), 30, "in-period turns of this familiar and model only");
assert.equal(total(await ask("openai/gpt-5.5")), 40);

// Unchanged updatedAt: the remembered facts are used, the file is not read.
write("current", {
  updatedAt: "2026-09-20T00:00:00.000Z",
  turns: [reply("a", "2026-09-10T00:00:00.000Z", 5000, "anthropic/claude-opus-5-5")],
});
clearConversationListMetadataCache();
assert.equal(total(await ask()), 30, "an unchanged conversation is not re-read");

// A write stamps a new updatedAt, and the new usage counts.
write("current", {
  updatedAt: "2026-09-23T00:00:00.000Z",
  turns: [reply("a", "2026-09-10T00:00:00.000Z", 7, "anthropic/claude-opus-5-5")],
});
clearConversationListMetadataCache();
assert.equal(total(await ask()), 27, "a written conversation is re-read");

clearChatUsageFacts();
assert.equal(total(await ask()), 27, "clearing the facts reproduces the same totals");

// A chat with no attributable turns still shows its own period usage.
write("unattributed", {
  familiarId: "sage", updatedAt: "2026-09-24T00:00:00.000Z",
  turns: [reply("g", "2026-09-13T00:00:00.000Z", 3)],
});
clearConversationListMetadataCache();
assert.equal(
  total(await usageTurnsForPlan({ familiarId: "sage", sessionId: "unattributed", model: "x/unknown", ...period })),
  3,
);

console.log("chat-usage-turns.test.ts: all assertions passed");
