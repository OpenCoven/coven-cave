// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-hydrate-"));
process.env.HOME = TMP;

const { hydrateForVoiceCall } = await import("./hydrate-instructions.ts");

const FAMILIAR_ID = "milo";
const SESSION_ID = "sess-1";

function writeConvFile(turns: Array<{ role: string; text: string }>) {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  const conv = {
    sessionId: SESSION_ID,
    familiarId: FAMILIAR_ID,
    harness: "claude",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-09T00:00:00Z",
    turns: turns.map((t, i) => ({
      id: `t${i}`,
      role: t.role,
      text: t.text,
      createdAt: `2026-06-09T0${i}:00:00Z`,
    })),
  };
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify(conv));
}

function writeFamiliarConfig(familiar: Record<string, unknown>) {
  const dir = join(TMP, ".coven");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "cave-config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: familiar } }),
  );
}

test("instructions include display_name + role + description + pronouns + note", async () => {
  writeFamiliarConfig({
    display_name: "Milo",
    role: "research familiar",
    pronouns: "they/them",
    description: "calm and thorough",
    note: "skip preamble",
  });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Milo \(they\/them\)/);
  assert.match(out.instructions, /Your role: research familiar/);
  assert.match(out.instructions, /About you: calm and thorough/);
  assert.match(out.instructions, /Notes for this conversation: skip preamble/);
  assert.match(out.instructions, /live voice call/);
});

test("instructions omit blank lines for missing optional fields", async () => {
  writeFamiliarConfig({
    display_name: "Echo",
    role: "scribe",
  });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Echo,/);
  assert.doesNotMatch(out.instructions, /About you:/);
  assert.doesNotMatch(out.instructions, /Notes for this conversation:/);
  assert.doesNotMatch(out.instructions, /undefined/);
});

test("conversationSeed projects last N turns; default 12", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile(
    Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    })),
  );
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.equal(out.conversationSeed.length, 12);
  assert.equal(out.conversationSeed[0].content, "turn 8");
  assert.equal(out.conversationSeed[11].content, "turn 19");
});

test("conversationSeed respects custom seedTurns", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile(
    Array.from({ length: 5 }, (_, i) => ({ role: "user", text: `t${i}` })),
  );
  const out = await hydrateForVoiceCall(
    { familiarId: FAMILIAR_ID, sessionId: SESSION_ID },
    { seedTurns: 3 },
  );
  assert.equal(out.conversationSeed.length, 3);
  assert.deepEqual(out.conversationSeed.map(t => t.content), ["t2", "t3", "t4"]);
});

test("conversationSeed filters out system-role turns", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile([
    { role: "system", text: "ignored" },
    { role: "user", text: "kept-user" },
    { role: "assistant", text: "kept-asst" },
  ]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.deepEqual(out.conversationSeed, [
    { role: "user", content: "kept-user" },
    { role: "assistant", content: "kept-asst" },
  ]);
});

test("conversationSeed is [] when the session file is missing", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  // Don't write a conversation file.
  const out = await hydrateForVoiceCall(
    { familiarId: FAMILIAR_ID, sessionId: "does-not-exist" },
    undefined,
  );
  assert.deepEqual(out.conversationSeed, []);
});
