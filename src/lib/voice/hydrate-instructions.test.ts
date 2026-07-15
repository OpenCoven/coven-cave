// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-hydrate-"));
process.env.HOME = TMP;

const { hydrateForVoiceCall, VOICE_INSTRUCTIONS_CHARS } = await import("./hydrate-instructions.ts");

const FAMILIAR_ID = "milo";
const SESSION_ID = "sess-1";

function writeConvFile(turns: Array<{ role: string; text: string }>) {
  const dir = join(TMP, ".coven", "cave", "conversations");
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

function writeFamiliarConfig(
  familiar: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const dir = join(TMP, ".coven", "cave");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: familiar }, ...extra }),
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

// ── Deep hydration: canon / roles / contract files / knowledge vault ─────────
// Ordering matters below: contract files and vault entries persist in TMP once
// written, so absence assertions run before the tests that create them.

test("instructions carry the Coven identity canon with the familiar id", async () => {
  writeFamiliarConfig({ display_name: "Milo", role: "scout" });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Coven identity canon:/);
  assert.match(out.instructions, /Current familiar: milo\./);
});

test("active roles for this familiar are listed; inactive and foreign roles are not", async () => {
  writeFamiliarConfig(
    { display_name: "Milo", role: "scout" },
    {
      roles: [
        { id: "researcher", familiar: FAMILIAR_ID, active: true },
        { id: "dormant", familiar: FAMILIAR_ID, active: false },
        { id: "scribe", familiar: "someone-else", active: true },
      ],
    },
  );
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Active roles: researcher\./);
  assert.doesNotMatch(out.instructions, /dormant/);
  assert.doesNotMatch(out.instructions, /scribe/);
});

test("no contract block when the familiar has no identity files", async () => {
  writeFamiliarConfig({ display_name: "Milo", role: "scout" });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.doesNotMatch(out.instructions, /<FAMILIAR_CONTRACT>/);
});

test("an invalid familiar id degrades to persona defaults without throwing", async () => {
  const out = await hydrateForVoiceCall({ familiarId: "../evil", sessionId: SESSION_ID });
  assert.match(out.instructions, /the familiar, a familiar/);
  assert.doesNotMatch(out.instructions, /<FAMILIAR_CONTRACT>/);
});

function writeContractFile(name: string, content: string) {
  const dir = join(TMP, ".coven", "workspaces", "familiars", FAMILIAR_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

test("SOUL.md / IDENTITY.md / MEMORY.md are inlined under FAMILIAR_CONTRACT", async () => {
  writeFamiliarConfig({ display_name: "Milo", role: "scout" });
  writeConvFile([]);
  writeContractFile("SOUL.md", "# SOUL.md — Who I Am\n## I am Milo\nMy purpose is scouting.");
  writeContractFile("IDENTITY.md", "# IDENTITY.md - Milo\n- **Creature:** fox");
  writeContractFile("MEMORY.md", "# MEMORY.md\nThe user prefers terse answers.");
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /<FAMILIAR_CONTRACT>/);
  assert.match(out.instructions, /## SOUL\.md\n# SOUL\.md — Who I Am/);
  assert.match(out.instructions, /My purpose is scouting\./);
  assert.match(out.instructions, /\*\*Creature:\*\* fox/);
  assert.match(out.instructions, /The user prefers terse answers\./);
  assert.match(out.instructions, /<\/FAMILIAR_CONTRACT>/);
  // The voice-call behavioral instruction stays last, after every identity block.
  assert.ok(
    out.instructions.indexOf("live voice call") >
      out.instructions.indexOf("</FAMILIAR_CONTRACT>"),
  );
});

test("an oversized SOUL.md is clamped and can never fail the mint", async () => {
  writeFamiliarConfig({ display_name: "Milo", role: "scout" });
  writeConvFile([]);
  writeContractFile("SOUL.md", `# SOUL.md\n${"s".repeat(50_000)}`);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /<FAMILIAR_CONTRACT>/);
  assert.ok(out.instructions.length <= VOICE_INSTRUCTIONS_CHARS);
  assert.match(out.instructions, /…/);
  // Clamping one file must not swallow the blocks after it.
  assert.match(out.instructions, /live voice call/);
});

function writeVaultEntry(id: string, frontmatter: string, body: string) {
  const dir = join(TMP, ".coven", "knowledge");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), `---\n${frontmatter}\n---\n${body}\n`);
}

test("familiar-scoped Knowledge Vault entries reach the voice instructions", async () => {
  writeFamiliarConfig({ display_name: "Milo", role: "scout" });
  writeConvFile([]);
  writeVaultEntry(
    "style-guide",
    'title: "Style Guide"\ntags: [style]\nscope: global\nenabled: true',
    "Always answer in haiku.",
  );
  writeVaultEntry(
    "other-secret",
    'title: "Other Secret"\ntags: []\nscope: [someone-else]\nenabled: true',
    "Not for milo.",
  );
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /<KNOWLEDGE_VAULT>/);
  assert.match(out.instructions, /Always answer in haiku\./);
  assert.doesNotMatch(out.instructions, /Not for milo\./);
});
