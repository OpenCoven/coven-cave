// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makePin } from "../stitch.ts";
import { readKnowledgeEntry, writeCollectionMeta } from "./knowledge-vault.ts";
import {
  buildSewInvocation,
  normalizeSewDraft,
  runDraftSew,
  runManualSew,
  uniqueStitchId,
  writeSewnEntry,
} from "./stitch-sew.ts";

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
  delete process.env.COVEN_CODEX_BIN;

  // A shape rides into the prompt through the same invocation (cave-kwx4).
  inv = buildSewInvocation(thread, "/tmp/last.txt", { scaffold: ["Steps"], tagHints: ["how-to"] });
  assert.match(inv.stdinPrompt, /- Steps/);
  assert.match(inv.stdinPrompt, /Prefer these tags when they fit: how-to/);

  // ── caller-supplied draft normalization (the chat lane, cave-x1za) ────────
  assert.deepEqual(normalizeSewDraft({ title: " T ", tags: ["A", " b ", 3, ""], body: " Body " }), {
    title: "T",
    tags: ["a", "b"],
    body: "Body",
  });
  assert.equal(normalizeSewDraft({ title: "T", body: "" }), null, "empty body rejected");
  assert.equal(normalizeSewDraft({ title: "", body: "b" }), null, "empty title rejected");
  assert.equal(normalizeSewDraft("nope"), null);
  assert.equal(normalizeSewDraft(null), null);
  assert.equal(normalizeSewDraft({ title: "T", body: "x".repeat(200_001) }), null, "oversize body rejected");
  assert.equal(normalizeSewDraft({ title: "T", body: "b" })?.tags.length, 0, "tags optional");

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

  // ── sew into a collection (cave-kwx4) ──────────────────────────────────────
  await writeCollectionMeta("policies", { name: "Policies" });
  const filed = await writeSewnEntry(thread, { title: "Retry Policy", tags: ["ops"], body: "Filed." }, "policies");
  assert.equal(filed.ok, true);
  assert.equal(filed.entry.collection, "policies");
  // Ids are unique per destination — the root entry didn't force a suffix.
  assert.equal(filed.entry.id, "retry-policy");
  const rereadFiled = await readKnowledgeEntry("retry-policy", "policies");
  assert.equal(rereadFiled.body, "Filed.");
  assert.deepEqual(rereadFiled.pins, [{ kind: "paste", ref: "paste", title: "Note" }]);

  // ── manual sew inherits shape: scaffold headings + tag hints (cave-kwx4) ──
  const manual = await runManualSew(thread, { shape: { scaffold: ["Steps"], tagHints: ["How-To", ""] } });
  assert.equal(manual.ok, true);
  assert.deepEqual(manual.entry.tags, ["how-to"], "tag hints replace the old empty default");
  assert.match(manual.entry.body, /^## Steps\n\n_Fill in\._/);
  assert.match(manual.entry.body, /## Note/, "pins still concatenated below");

  // ── draft sew: the chat lane's finish (cave-x1za) ──────────────────────────
  const drafted = await runDraftSew(thread, { title: "Chat Drafted", tags: ["chat"], body: "From chat." });
  assert.equal(drafted.ok, true);
  assert.equal(drafted.entry.id, "chat-drafted");
  assert.deepEqual(drafted.entry.pins, [{ kind: "paste", ref: "paste", title: "Note" }], "provenance intact");
  const noPins = await runDraftSew({ ...thread, pins: [] }, { title: "X", tags: [], body: "b" });
  assert.equal(noPins.ok, false, "a draft still needs a pinned thread");

  console.log("stitch-sew.test.ts OK");
} finally {
  if (prevVault === undefined) delete process.env.COVEN_KNOWLEDGE_DIR;
  else process.env.COVEN_KNOWLEDGE_DIR = prevVault;
  if (prevBin === undefined) delete process.env.COVEN_CODEX_BIN;
  else process.env.COVEN_CODEX_BIN = prevBin;
  rmSync(dir, { recursive: true, force: true });
}
