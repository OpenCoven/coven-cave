// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPromptWithKnowledgeVault,
  deleteKnowledgeEntry,
  isValidKnowledgeId,
  listKnowledgeEntries,
  normalizeScope,
  parseKnowledgeFile,
  readKnowledgeVaultForPrompt,
  selectKnowledgeForFamiliar,
  serializeKnowledgeEntry,
  slugifyKnowledgeId,
  writeKnowledgeEntry,
} from "./knowledge-vault.ts";

// ── id guard ─────────────────────────────────────────────────────────────────
assert.equal(isValidKnowledgeId("api-style_guide1"), true);
assert.equal(isValidKnowledgeId("UPPER"), false, "ids are lowercase-only");
assert.equal(isValidKnowledgeId("../escape"), false, "no traversal");
assert.equal(isValidKnowledgeId("has/slash"), false);
assert.equal(isValidKnowledgeId("has.dot"), false);
assert.equal(isValidKnowledgeId(""), false);
assert.equal(isValidKnowledgeId(42), false);
assert.equal(slugifyKnowledgeId("API Style Guide!"), "api-style-guide");

// ── scope normalization ──────────────────────────────────────────────────────
assert.equal(normalizeScope(undefined), "global");
assert.equal(normalizeScope("global"), "global");
assert.equal(normalizeScope("  "), "global");
assert.equal(normalizeScope("all"), "global");
assert.equal(normalizeScope(["*"]), "global");
assert.deepEqual(normalizeScope("sage echo"), ["sage", "echo"]);
assert.deepEqual(normalizeScope("sage, echo"), ["sage", "echo"]);
assert.deepEqual(normalizeScope(["sage", "echo"]), ["sage", "echo"]);

// ── parse round-trips with serialize ─────────────────────────────────────────
{
  const entry = {
    id: "guide",
    title: "Style Guide",
    tags: ["api", "conventions"],
    scope: ["sage"],
    enabled: true,
    body: "Use kebab-case for routes.",
  };
  const parsed = parseKnowledgeFile("guide", serializeKnowledgeEntry(entry));
  assert.deepEqual(parsed, entry, "serialize → parse is lossless");
}

// frontmatter-less file → whole thing is body, title falls back to id
{
  const parsed = parseKnowledgeFile("notes", "just some text\n");
  assert.equal(parsed.title, "notes");
  assert.equal(parsed.scope, "global");
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.body, "just some text");
}

// enabled:false is honored; malformed frontmatter degrades gracefully
{
  const off = parseKnowledgeFile("x", "---\ntitle: X\nenabled: false\n---\nbody");
  assert.equal(off.enabled, false);
  const bad = parseKnowledgeFile("y", "---\n: : not yaml :\n---\nbody");
  assert.equal(bad.title, "y");
}

// ── scope selection ──────────────────────────────────────────────────────────
{
  const entries = [
    { id: "g", title: "G", tags: [], scope: "global", enabled: true, body: "g" },
    { id: "s", title: "S", tags: [], scope: ["sage"], enabled: true, body: "s" },
    { id: "off", title: "Off", tags: [], scope: "global", enabled: false, body: "off" },
  ];
  assert.deepEqual(
    selectKnowledgeForFamiliar(entries, "sage").map((e) => e.id),
    ["g", "s"],
    "sage sees global + sage-scoped, never disabled",
  );
  assert.deepEqual(
    selectKnowledgeForFamiliar(entries, "echo").map((e) => e.id),
    ["g"],
    "echo sees only global",
  );
  assert.deepEqual(
    selectKnowledgeForFamiliar(entries, undefined).map((e) => e.id),
    ["g"],
    "no familiar → only global",
  );
}

// ── prompt block ─────────────────────────────────────────────────────────────
assert.equal(
  buildPromptWithKnowledgeVault("hello", []),
  "hello",
  "no entries → prompt unchanged",
);
{
  const out = buildPromptWithKnowledgeVault("USER PROMPT", [
    { id: "g", title: "Glossary", tags: ["domain"], scope: "global", enabled: true, body: "Coven = a set of familiars." },
    { id: "empty", title: "Empty", tags: [], scope: "global", enabled: true, body: "   " },
  ]);
  assert.match(out, /<KNOWLEDGE_VAULT>/);
  assert.match(out, /<\/KNOWLEDGE_VAULT>/);
  assert.match(out, /## Glossary {2}\[tags: domain\]/);
  assert.match(out, /Coven = a set of familiars\./);
  assert.doesNotMatch(out, /## Empty/, "empty-body entries are dropped");
  assert.ok(out.trimEnd().endsWith("USER PROMPT"), "user prompt stays at the end");
}

// ── filesystem round-trip (temp dir via COVEN_KNOWLEDGE_DIR) ──────────────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "kv-test-"));
  const prev = process.env.COVEN_KNOWLEDGE_DIR;
  process.env.COVEN_KNOWLEDGE_DIR = dir;
  try {
    assert.deepEqual(await listKnowledgeEntries(), [], "absent/empty dir → []");
    await writeKnowledgeEntry({
      id: "ship-rules",
      title: "Ship Rules",
      tags: ["process"],
      scope: ["sage"],
      enabled: true,
      body: "All changes go through a PR.",
    });
    const all = await listKnowledgeEntries();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, "ship-rules");
    assert.deepEqual(all[0].scope, ["sage"]);

    const forSage = await readKnowledgeVaultForPrompt("sage");
    assert.equal(forSage.length, 1);
    const forEcho = await readKnowledgeVaultForPrompt("echo");
    assert.equal(forEcho.length, 0, "sage-scoped entry hidden from echo");

    assert.equal(await deleteKnowledgeEntry("ship-rules"), true);
    assert.equal(await deleteKnowledgeEntry("ship-rules"), false, "second delete → false");
    assert.deepEqual(await listKnowledgeEntries(), []);
  } finally {
    if (prev === undefined) delete process.env.COVEN_KNOWLEDGE_DIR;
    else process.env.COVEN_KNOWLEDGE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("knowledge-vault.test.ts: ok");
