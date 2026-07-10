// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makePin } from "../stitch.ts";
import { readKnowledgeEntry } from "./knowledge-vault.ts";
import { buildSewInvocation, uniqueStitchId, writeSewnEntry } from "./stitch-sew.ts";

const dir = mkdtempSync(path.join(tmpdir(), "stitch-sew-test-"));
const prevVault = process.env.COVEN_KNOWLEDGE_DIR;
const prevBin = process.env.COVEN_CODEX_BIN;
process.env.COVEN_KNOWLEDGE_DIR = dir;

try {
  // ── invocation builder ─────────────────────────────────────────────────────
  const thread = {
    id: "t1",
    title: "Retry policy",
    pins: [makePin({ kind: "paste", ref: "paste", title: "Note", content: "Use 5 retries." })],
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };

  delete process.env.COVEN_CODEX_BIN;
  let inv = buildSewInvocation(thread, "/tmp/last.txt");
  assert.equal(inv.command, "codex");
  // --sandbox read-only pins the run's privileges: the prompt embeds
  // attacker-influenceable remote content, and a distillation needs no tools.
  assert.deepEqual(inv.args, ["exec", "--sandbox", "read-only", "--output-last-message", "/tmp/last.txt", "-"]);
  assert.match(inv.stdinPrompt, /TITLE: <entry title/);
  assert.match(inv.stdinPrompt, /Use 5 retries\./);

  process.env.COVEN_CODEX_BIN = "/opt/custom/codex";
  inv = buildSewInvocation(thread, "/tmp/last.txt");
  assert.equal(inv.command, "/opt/custom/codex");

  // ── unique id derivation ───────────────────────────────────────────────────
  assert.equal(await uniqueStitchId("Webhook Retry Policy!"), "webhook-retry-policy");
  assert.equal(await uniqueStitchId("!!!"), "stitch", "unsluggable titles fall back");

  // ── sewn entry persistence with provenance ─────────────────────────────────
  const first = await writeSewnEntry(thread, { title: "Retry Policy", tags: ["retries"], body: "Use 5 retries." });
  assert.equal(first.ok, true);
  assert.equal(first.entry.id, "retry-policy");
  assert.deepEqual(first.entry.pins, [{ kind: "paste", ref: "paste", title: "Note" }]);

  // Round-trip: provenance survives the vault's parse.
  const reread = await readKnowledgeEntry("retry-policy");
  assert.equal(reread.title, "Retry Policy");
  assert.deepEqual(reread.pins, [{ kind: "paste", ref: "paste", title: "Note" }]);
  assert.equal(reread.enabled, true);
  assert.equal(reread.scope, "global");

  // A second sew with the same title gets a suffixed id, never a clobber.
  const second = await writeSewnEntry(thread, { title: "Retry Policy", tags: [], body: "v2" });
  assert.equal(second.ok, true);
  assert.equal(second.entry.id, "retry-policy-2");
  assert.equal((await readKnowledgeEntry("retry-policy")).body, "Use 5 retries.");

  console.log("stitch-sew.test.ts OK");
} finally {
  if (prevVault === undefined) delete process.env.COVEN_KNOWLEDGE_DIR;
  else process.env.COVEN_KNOWLEDGE_DIR = prevVault;
  if (prevBin === undefined) delete process.env.COVEN_CODEX_BIN;
  else process.env.COVEN_CODEX_BIN = prevBin;
  rmSync(dir, { recursive: true, force: true });
}
