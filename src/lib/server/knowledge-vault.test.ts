// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPromptWithKnowledgeVault,
  deleteKnowledgeEntry,
  isValidKnowledgeId,
  KNOWLEDGE_VAULT_BODY_BUDGET,
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

// unknown frontmatter keys are preserved exactly through parse → serialize → parse
{
  const raw = "---\ntitle: Character\ntags: [npc]\ntype: character\nstatus: draft\nflags:\n  - haunted\n  - royal\n---\nBody\n";
  const parsed = parseKnowledgeFile("character", raw);
  assert.deepEqual(parsed.extra, {
    type: "character",
    status: "draft",
    flags: ["haunted", "royal"],
  });
  const roundTripped = parseKnowledgeFile("character", serializeKnowledgeEntry(parsed));
  assert.deepEqual(roundTripped.extra, parsed.extra, "extra frontmatter survives serialize round-trip");
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

// ── body budget ──────────────────────────────────────────────────────────────
// Regression: the vault was injected unbudgeted, so the 68 KB global "OpenCoven"
// entry (five full repo READMEs) rode along on every prompt for every familiar.
// Threads self-reported that as `excess` context pressure.
{
  const huge = "line of reference material\n".repeat(6000); // ~162 KB
  const out = buildPromptWithKnowledgeVault("USER PROMPT", [
    { id: "huge", title: "OpenCoven", tags: [], scope: "global", enabled: true, body: huge },
  ]);
  assert.ok(
    out.length < KNOWLEDGE_VAULT_BODY_BUDGET * 1.5,
    `oversized entry is clipped to the budget (got ${out.length})`,
  );
  assert.match(out, /## OpenCoven/, "the entry is still present and named");
  assert.match(out, /more characters of "OpenCoven" omitted/, "clipping is disclosed, not silent");
  assert.ok(out.trimEnd().endsWith("USER PROMPT"), "user prompt survives clipping");
}
{
  // Small entries are never touched, and a big one does not starve them.
  const small = { id: "s", title: "Glossary", tags: [], scope: "global" as const, enabled: true, body: "Coven = a set of familiars." };
  const big = { id: "b", title: "Big", tags: [], scope: "global" as const, enabled: true, body: "z".repeat(80_000) };
  const out = buildPromptWithKnowledgeVault("USER PROMPT", [small, big]);
  assert.match(out, /Coven = a set of familiars\./, "small entries pass through whole");
  assert.match(out, /more characters of "Big" omitted/, "only the oversized entry is clipped");

  const under = buildPromptWithKnowledgeVault("USER PROMPT", [small]);
  assert.doesNotMatch(under, /omitted to bound prompt size/, "under-budget vaults are untouched");

  const unbounded = buildPromptWithKnowledgeVault("USER PROMPT", [big], [], { bodyBudget: Infinity });
  assert.ok(unbounded.includes("z".repeat(80_000)), "callers can opt out of the budget");
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
