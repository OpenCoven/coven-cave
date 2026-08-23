// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFamiliarSectionData } from "./familiar-tab-section-model.ts";

// One derivation feeds every Familiar-tab section — these fixtures pin the
// provenance math (role-granted vs familiar vs global), the dedupe rules, and
// the unique-count the Skills tab badge shows.

const familiar = { id: "sage", display_name: "Sage", harness: "claude" };

const roles = [
  { id: "librarian", name: "Librarian", familiar: "sage", active: true, skills: ["library", "pdf"] },
  { id: "researcher", name: "Researcher", familiar: "all", active: true, skills: ["library"] },
  { id: "dormant", name: "Dormant", familiar: "sage", active: false, skills: ["retro"] },
  { id: "other", name: "Other", familiar: "nova", active: true, skills: ["email-triage"] },
];

const localSkills = [
  { id: "library", name: "library", kind: "agent", familiar: "global", path: "/skills/library", tags: ["catalog"], description: "Local library index." },
  { id: "summarize", name: "summarize", kind: "agent", familiar: "global", path: "/skills/summarize", tags: [] },
  { id: "coven-sage", name: "coven-sage", kind: "agent", familiar: "sage", path: "/skills/coven-sage", tags: ["doctrine"] },
];

const harnessCapabilities = [
  {
    harness_id: "claude",
    scanned_at: "2026-07-21T00:00:00Z",
    skills: [{ id: "summarize" }, { id: "manifest-only" }],
    plugins: [
      { id: "p1", name: "github", kind: "mcp", enabled: true },
      { id: "p2", name: "linter", kind: "plugin", enabled: true },
    ],
    warnings: [],
  },
  { harness_id: "codex", scanned_at: "", skills: [{ id: "elsewhere" }], plugins: [], warnings: [] },
];

const harnesses = [
  { id: "claude", label: "Claude Code", installed: true },
  { id: "codex", label: "Codex", installed: true },
];

function derive(overrides = {}) {
  return deriveFamiliarSectionData({
    familiar,
    roles,
    localSkills,
    harnessCapabilities,
    harnesses,
    errors: [],
    ...overrides,
  });
}

test("active roles scope to this familiar plus all/global; inactive and foreign roles drop", () => {
  const data = derive();
  assert.deepEqual(
    data.activeRoles.map((r) => r.id).sort(),
    ["librarian", "researcher"],
  );
});

test("skill rows carry provenance: role grants first, then familiar, then global", () => {
  const data = derive();
  assert.deepEqual(
    data.skillRows.map((row) => `${row.sourceKind}:${row.id}`),
    ["role:library", "role:pdf", "familiar:coven-sage", "global:library", "global:summarize"],
  );
  // A role grant resolved against the local scan inherits its metadata…
  const granted = data.skillRows.find((row) => row.sourceKind === "role" && row.id === "library");
  assert.equal(granted.source, "Librarian");
  assert.equal(granted.path, "/skills/library");
  assert.equal(granted.description, "Local library index.");
  // …and an unresolved grant still gets a row (the grant is real).
  const missing = data.skillRows.find((row) => row.id === "pdf");
  assert.equal(missing.name, "pdf");
  assert.equal(missing.path, undefined);
});

test("the same skill granted by two roles dedupes to one role row", () => {
  const data = derive();
  assert.equal(data.skillRows.filter((row) => row.id === "library" && row.sourceKind === "role").length, 1);
});

test("skillCount is the unique id set across rows AND the harness manifest", () => {
  const data = derive();
  // library, pdf, coven-sage, summarize + manifest-only (manifest) = 5 unique.
  assert.equal(data.skillCount, 5);
});

test("plugins split by kind against this familiar's harness manifest only", () => {
  const data = derive();
  assert.deepEqual(data.mcpPlugins.map((p) => p.name), ["github"]);
  assert.deepEqual(data.nonMcpPlugins.map((p) => p.name), ["linter"]);
  assert.equal(data.manifest.harness_id, "claude");
  assert.equal(data.harnessReport.label, "Claude Code");
});

test("a familiar without a harness falls back to codex", () => {
  const data = derive({ familiar: { id: "sage", display_name: "Sage" } });
  assert.equal(data.harnessId, "codex");
  assert.equal(data.manifest.harness_id, "codex");
});
