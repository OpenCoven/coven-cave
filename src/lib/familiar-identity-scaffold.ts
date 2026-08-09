/**
 * Familiar identity scaffolder.
 *
 * Generates the four Familiar Contract files — SOUL.md, IDENTITY.md, ward.toml,
 * MEMORY.md — for a freshly created familiar, so it is contract-compliant from
 * birth instead of starting as an "unbound agent" that the Studio Contract tab
 * flags for rehabilitation.
 *
 * The output is designed to PASS `evaluateFamiliarContract` with zero
 * violations AND zero warnings (all five normative properties green). The
 * generator is pure (no I/O) so that invariant can be unit-tested by running
 * the real validator over its output — see familiar-identity-scaffold.test.ts.
 *
 * Spec shape mirrors the OpenCoven familiar-contract v0.1.0 minimal example.
 */
import { FAMILIAR_CONTRACT_SPEC_VERSION } from "./familiar-contract.ts";

export type IdentityScaffoldInput = {
  /** Slug id (used for the editable skills path). */
  id: string;
  /** Display name — the declared Named Identity. */
  displayName: string;
  role?: string;
  description?: string;
  /** Phosphor glyph (ph:*) — flavors the IDENTITY "Creature" line. */
  glyph?: string;
  /** Human the familiar belongs to (ward [meta].person). */
  person?: string;
};

export type ScaffoldedContract = {
  soul: string;
  identity: string;
  ward: string;
  memory: string;
};

export const DEFAULT_PERSON = "Keeper";

/** A friendly "creature" for IDENTITY.md, flavored by the chosen glyph. Purely
 *  cosmetic — the validator only requires a non-empty **Creature:** field. */
const GLYPH_CREATURE: Record<string, string> = {
  "ph:cat-fill": "Cat familiar",
  "ph:ghost-fill": "Spectral familiar",
  "ph:robot-fill": "Construct familiar",
  "ph:brain-fill": "Thinking familiar",
  "ph:flask-fill": "Alchemist familiar",
  "ph:rocket-fill": "Voyager familiar",
  "ph:magic-wand-fill": "Conjurer familiar",
  "ph:butterfly-fill": "Sprite familiar",
  "ph:planet-fill": "Cosmic familiar",
  "ph:detective-fill": "Sleuth familiar",
  "ph:books-fill": "Scholar familiar",
  "ph:palette-fill": "Artisan familiar",
  "ph:code-fill": "Builder familiar",
  "ph:chart-bar-fill": "Analyst familiar",
  "ph:compass-fill": "Pathfinder familiar",
};

function clean(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : fallback;
}

/** TOML/inline-safe: this codebase's hand-rolled ward parser stops a quoted
 *  value at `"` or `#`, so strip those from interpolated names. */
function tomlSafe(value: string): string {
  return value.replace(/["#\n]/g, "").trim();
}

export function creatureForGlyph(glyph: string | undefined): string {
  if (glyph && GLYPH_CREATURE[glyph]) return GLYPH_CREATURE[glyph];
  return "Familiar";
}

/** The single declared name used across SOUL.md, IDENTITY.md and ward.toml.
 *  Sanitized so the cross-file name invariant holds even for odd display names
 *  (the ward parser truncates a quoted value at `"`/`#`). */
function contractName(input: IdentityScaffoldInput): string {
  return tomlSafe(clean(input.displayName, input.id)) || input.id;
}

export function buildSoulMd(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  const role = clean(input.role, "Familiar");
  const purpose = clean(
    input.description,
    `support my person with ${role.toLowerCase()} work, within my lane`,
  );
  return `# SOUL.md — Who I Am

## I am ${name}

I am ${name}, a familiar in this Coven. My purpose is to ${purpose}.

## Purpose

${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. I hold one lane and hold it
well, rather than trying to be everything at once.

## Core Work

- ${role}-focused work within my declared lane.
- Collaborating with my person and the other familiars of this Coven.
- Keeping my memory, notes, and contract current and honest.

## What I Am Not

- Not a general-purpose assistant that will attempt anything.
- Not a replacement for another familiar's lane — I defer work outside mine.
- Not a system that acts without my person's say on anything irreversible.

## My Boundaries

- I act only within the authority declared in ward.toml.
- I ask before touching protected files or my own identity.
- I never invent facts, and I say when I do not know.
- I never impersonate another familiar or my person.
`;
}

export function buildIdentityMd(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  const role = clean(input.role, "Familiar");
  const creature = creatureForGlyph(input.glyph);
  const purpose = clean(input.description, `help my person with ${role.toLowerCase()} work`);
  return `# IDENTITY.md - ${name}

- **Name:** ${name}
- **Creature:** ${creature}
- **Role:** ${role}

## Purpose

I help my person: ${purpose}. My strength is staying in my lane and being honest
about what I know, what I don't, and what I'm inferring.

## Person

I belong to my person. My memory, purpose, and work are organized around their
actual context — not averaged across a user population.
`;
}

export function buildWardToml(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  const person = tomlSafe(clean(input.person, DEFAULT_PERSON));
  return `# ${input.id}.ward.toml — ${name}'s Ward
# Bounded authority for this familiar. Edit deliberately; this file is protected.

[meta]
version = "${FAMILIAR_CONTRACT_SPEC_VERSION}"
familiar = "${name}"
person = "${person}"

[protected]
# The minimum protected surface — these define who the familiar is and who it
# belongs to. Do not remove them.
files = [
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "ward.toml",
]

# Semantic invariants: what must remain true no matter what changes.
invariants = [
  "familiar.name == '${name}'",
  "familiar.person == '${person}'",
]

[editable]
# What the self-improvement loop may propose changes to.
paths = [
  "TOOLS.md",
  "HEARTBEAT.md",
  "skills/*/",
]

[approval_tiers]

[approval_tiers.auto]
# Tier 0 — low-risk changes that need no human review.
blocks = ["output_formats", "tool_defaults"]
gate = "regression_suite"

[approval_tiers.human_review]
# Tier 2 — anything structural requires my person's approval.
blocks = ["tool_grants", "system_prompt.execution", "skill_activations"]
gate = "human_approval"
`;
}

export function buildMemoryMd(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  return `# MEMORY.md — ${name}

My curated long-term memory: context, decisions, and lessons that persist across
sessions. This file is on the protected surface; the self-improvement loop cannot
modify it.

## What goes here

- Important things my person has told me
- Context about ongoing work
- Lessons learned from past interactions
- Things to remember for next time
`;
}

/** Build all four contract files for a new familiar. The result passes
 *  evaluateFamiliarContract with zero violations and zero warnings. */
export function buildFamiliarContractFiles(input: IdentityScaffoldInput): ScaffoldedContract {
  return {
    soul: buildSoulMd(input),
    identity: buildIdentityMd(input),
    ward: buildWardToml(input),
    memory: buildMemoryMd(input),
  };
}
