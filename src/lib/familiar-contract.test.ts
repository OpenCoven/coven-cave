// @ts-nocheck
import assert from "node:assert/strict";
import {
  evaluateFamiliarContract,
  parseSoul,
  parseIdentity,
  parseWardToml,
  FAMILIAR_PROPERTIES,
  FAMILIAR_CONTRACT_SPEC_VERSION,
} from "./familiar-contract.ts";

// ── A fully compliant familiar (mirrors examples/sage from the spec repo) ──────

const COMPLIANT_SOUL = `# SOUL.md - Who I Am

## I am Sage

My purpose is **understanding**.

## Core Work

I help my person read and synthesize.

## What I Am Not

- Not a code assistant.

## My Boundaries

- Don't invent citations. Ever.
`;

const COMPLIANT_IDENTITY = `# IDENTITY.md - Sage

- **Name:** Sage
- **Creature:** Research familiar in the Coven
- **Pronouns:** they/them

## Purpose

I help my person investigate things deeply.
`;

const COMPLIANT_WARD = `[meta]
version = "0.1.0"
familiar = "sage"
person = "val"

[protected]
files = [
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "ward.toml",
]
invariants = [
  "familiar.name == 'Sage'",
  "familiar.person == 'val'",
]

[editable]
paths = [
  "TOOLS.md",
  "HEARTBEAT.md",
]

[approval_tiers]

[approval_tiers.auto]
gate = "regression_suite"

[approval_tiers.human_review]
gate = "human_approval"
`;

const COMPLIANT_MEMORY = `# MEMORY.md\n\n- Something durable worth remembering.\n`;

function compliantFiles(overrides = {}) {
  return {
    soul: COMPLIANT_SOUL,
    identity: COMPLIANT_IDENTITY,
    ward: COMPLIANT_WARD,
    memory: COMPLIANT_MEMORY,
    ...overrides,
  };
}

// ── Parsers ────────────────────────────────────────────────────────────────────

{
  const soul = parseSoul(COMPLIANT_SOUL);
  assert.equal(soul.hasName, true, "parseSoul detects '## I am <Name>'");
  assert.equal(soul.name, "Sage");
  assert.equal(soul.hasPurpose, true);
  assert.equal(soul.hasCoreWork, true);
  assert.equal(soul.hasWhatIAmNot, true);
  assert.equal(soul.hasBoundaries, true);

  const id = parseIdentity(COMPLIANT_IDENTITY);
  assert.equal(id.hasName, true);
  assert.equal(id.name, "Sage");
  assert.equal(id.hasCreature, true);
  assert.equal(id.hasPurpose, true);

  const ward = parseWardToml(COMPLIANT_WARD);
  assert.equal(ward.metaFamiliar, "sage");
  assert.equal(ward.metaPerson, "val");
  assert.equal(ward.metaVersion, "0.1.0");
  assert.deepEqual(ward.protectedFiles, ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"]);
  assert.equal(ward.protectedInvariants.length, 2);
  assert.deepEqual(ward.editablePaths, ["TOOLS.md", "HEARTBEAT.md"]);
  assert.equal(ward.hasApprovalTiers, true);
  assert.equal(ward.hasAutoTier, true);
  assert.equal(ward.hasHumanReviewTier, true);
  // The compliant ward names gates but no blocks, so both tiers read as empty
  // lists rather than as absent.
  assert.deepEqual(ward.autoTier, []);
  assert.deepEqual(ward.humanReviewTier, []);

  assert.equal(id.creature, "Research familiar in the Coven", "parseIdentity keeps the creature text");
  assert.equal(id.person, null, "no **Person:** field means no person");
  const withPerson = parseIdentity(`${COMPLIANT_IDENTITY}\n- **Person:** Val Alexander\n`);
  assert.equal(withPerson.person, "Val Alexander");
  assert.equal(parseIdentity("# IDENTITY.md - Bare\n- **Creature:**   \n").creature, null, "an empty creature field is absent, not blank");
}

// ── Approval tiers: both spellings the wards in the wild use ─────────────────

{
  // The scaffold's form: tier tables carrying `blocks`.
  const tables = parseWardToml(`[meta]
version = "0.1.0"
familiar = "scribe"
person = "val"

[approval_tiers]

[approval_tiers.auto]
blocks = ["output_formats", "tool_defaults"]
gate = "regression_suite"

[approval_tiers.human_review]
blocks = [
  "tool_grants",
  "system_prompt.execution",
]
gate = "human_approval"
`);
  assert.deepEqual(tables.autoTier, ["output_formats", "tool_defaults"]);
  assert.deepEqual(tables.humanReviewTier, ["tool_grants", "system_prompt.execution"]);
  assert.equal(tables.hasAutoTier, true);
  assert.equal(tables.hasHumanReviewTier, true);

  // The inline form: action lists directly under [approval_tiers].
  const inline = parseWardToml(`[meta]
version = "0.3.1"
familiar = "Astra"
person = "Val Alexander"

[protected]
files = ["SOUL.md", "ward.toml"]

[approval_tiers]
auto = ["read files", "search the web", "write to notes/"]
human_review = ["publish a finding", "open a pull request"]
`);
  assert.deepEqual(inline.autoTier, ["read files", "search the web", "write to notes/"]);
  assert.deepEqual(inline.humanReviewTier, ["publish a finding", "open a pull request"]);
  assert.equal(inline.hasApprovalTiers, true);
  // The inline form declares no tier tables, so the table flags stay false —
  // the validator's opinion of that is unchanged by reading the lists.
  assert.equal(inline.hasAutoTier, false);
  assert.deepEqual(inline.protectedFiles, ["SOUL.md", "ward.toml"], "the protected section still parses around the tiers");

  // A `blocks` key under an unrelated tier table is nobody's tier.
  const stray = parseWardToml(`[meta]
version = "0.1.0"
familiar = "x"
person = "y"

[approval_tiers.escalation]
blocks = ["everything"]
`);
  assert.deepEqual(stray.autoTier, []);
  assert.deepEqual(stray.humanReviewTier, []);
}

// ── Full PASS ───────────────────────────────────────────────────────────────────

{
  const report = evaluateFamiliarContract(compliantFiles());
  assert.equal(report.pass, true, "a fully compliant familiar passes");
  assert.equal(report.violations.length, 0, "no violations on the compliant set");
  assert.equal(report.warnings.length, 0, "no warnings when MEMORY.md is present");
  assert.equal(report.specVersion, FAMILIAR_CONTRACT_SPEC_VERSION);
  assert.equal(report.properties.length, FAMILIAR_PROPERTIES.length, "reports all five properties");
  assert.ok(report.properties.every((p) => p.pass), "all five properties pass");
}

// ── Missing every file → all five properties fail ────────────────────────────────

{
  const report = evaluateFamiliarContract({ soul: null, identity: null, ward: null, memory: null });
  assert.equal(report.pass, false, "a familiar with no identity files is non-compliant");
  assert.ok(report.violations.some((v) => v.file === "SOUL.md" && v.field === "file"));
  assert.ok(report.violations.some((v) => v.file === "IDENTITY.md" && v.field === "file"));
  assert.ok(report.violations.some((v) => v.file === "ward.toml" && v.field === "file"));
  assert.ok(report.warnings.some((w) => w.file === "MEMORY.md"), "missing MEMORY.md is a warning");
  assert.ok(report.properties.every((p) => !p.pass), "no property passes with nothing on disk");
}

// ── MEMORY.md missing is a WARNING, not a hard fail ──────────────────────────────

{
  const report = evaluateFamiliarContract(compliantFiles({ memory: null }));
  assert.equal(report.pass, true, "missing MEMORY.md still passes (warning only)");
  assert.equal(report.warnings.length, 1, "exactly one warning for the missing MEMORY.md");
  const memProp = report.properties.find((p) => p.property === "Persistent Memory");
  assert.equal(memProp.pass, false, "Persistent Memory coverage is unmet without MEMORY.md");
  const namedProp = report.properties.find((p) => p.property === "Named Identity");
  assert.equal(namedProp.pass, true, "other properties still pass");
}

// ── Property isolation: a SOUL purpose gap fails only Defined Purpose ─────────────

{
  const soulNoPurpose = COMPLIANT_SOUL.replace("## Core Work", "## Stuff").replace(
    "My purpose is **understanding**.",
    "I do things.",
  ).replace("## What I Am Not", "## Misc");
  const report = evaluateFamiliarContract(compliantFiles({ soul: soulNoPurpose }));
  assert.equal(report.pass, false);
  const defined = report.properties.find((p) => p.property === "Defined Purpose");
  assert.equal(defined.pass, false, "Defined Purpose fails when purpose/core-work/what-i-am-not are absent");
  const belonging = report.properties.find((p) => p.property === "Human Belonging");
  assert.equal(belonging.pass, true, "Human Belonging unaffected by a SOUL purpose gap");
}

// ── ward person/invariant gaps fail Human Belonging ──────────────────────────────

{
  const wardNoPerson = COMPLIANT_WARD.replace('person = "val"', "");
  const report = evaluateFamiliarContract(compliantFiles({ ward: wardNoPerson }));
  const belonging = report.properties.find((p) => p.property === "Human Belonging");
  assert.equal(belonging.pass, false, "Human Belonging fails without a person binding");
  assert.ok(report.violations.some((v) => v.field === "meta.person"));
}

// ── Cross-file name mismatch is flagged ──────────────────────────────────────────

{
  const wardWrongName = COMPLIANT_WARD.replace('familiar = "sage"', 'familiar = "echo"');
  const report = evaluateFamiliarContract(compliantFiles({ ward: wardWrongName }));
  assert.ok(
    report.violations.some((v) => v.file === "cross-file" && v.field === "name consistency"),
    "SOUL name must match ward familiar",
  );
}

console.log("familiar-contract.test.ts: ok");
