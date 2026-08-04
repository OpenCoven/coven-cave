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
 *
 * **The manner is the only model-shaped part.** SOUL.md used to be identical
 * for every familiar but its name and role, which made the file furniture
 * rather than an identity. The scry now reads three qualities off the likeness
 * — voice, temperament, reasoning — and this module prints them into a section
 * it owns. The model fills SLOTS; it never authors the file. Every interpolated
 * value is re-sanitised here (`src/lib/familiar-soul.ts`) no matter who sent
 * it, and every slot sits after literal text on a line this file opened, so
 * nothing arriving from a model can start a line, open a section, or change the
 * file's shape. A hostile or unusable value falls back to the generic template,
 * which is a perfectly good soul and always a successful summoning.
 */
import { FAMILIAR_CONTRACT_SPEC_VERSION } from "./familiar-contract.ts";
import {
  hasSoulQualities,
  sanitizeInlineText,
  sanitizeSoulQualities,
  SOUL_QUALITY_FIELDS,
} from "./familiar-soul.ts";

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
  /**
   * Voice / temperament / reasoning, read from the likeness by the scry and
   * edited by the person before the seal was struck (see `src/lib/scry.ts`).
   *
   * SLOTS, not authorship: each surviving quality is printed after a fixed
   * label on a line this file owns, and is re-sanitised here regardless of who
   * sent it. Omitted, empty, or hostile → the generic template below, which is
   * exactly the file this scaffolder produced before qualities existed.
   */
  soul?: unknown;
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

/** Longest role / description this scaffolder will print into a markdown body.
 *  Matches the bounds the scry already applies to the same two fields. */
const ROLE_MAX = 60;
const DESCRIPTION_MAX = 280;

/**
 * Markdown-safe role and purpose.
 *
 * Both arrive from the scry (a model reading a picture) or from an API caller,
 * and both land inside SOUL.md / IDENTITY.md — where a newline plus `## I am`
 * would forge a second declared name and break the cross-file invariant this
 * module promises to hold. `sanitizeInlineText` collapses each to one
 * structure-free line, so an unusable value falls back to the default rather
 * than reshaping the file.
 */
function prose(value: string | undefined, max: number, fallback: string): string {
  return sanitizeInlineText(value, max) || fallback;
}

/** The description is printed mid-sentence ("My purpose is to …."), and a
 *  scried one arrives as a full sentence. Drop the terminal stop so the
 *  template supplies exactly one. */
function unterminated(value: string): string {
  return value.replace(/[.!?]+$/, "") || value;
}

/**
 * TOML/inline-safe: this codebase's hand-rolled ward parser stops a quoted
 * value at `"` or `#`, so strip those from interpolated names.
 *
 * Control characters go too, not only `\n`: a lone `\r` does not split a line
 * for `parseSoul` but does split one for anything else that reads these files,
 * and a name is a single line in every file it appears in.
 */
function tomlSafe(value: string): string {
  return value.replace(/["#]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * The manner section — the one part of SOUL.md that differs between two
 * familiars scaffolded from the same role.
 *
 * Every quality is printed as `- **Label.** <quality>`: the line is opened by
 * literal text this file controls, so an interpolated value can never begin a
 * line, and `sanitizeSoulQuality` has already removed every newline and
 * structural character from it. A familiar with no usable qualities gets no
 * section at all, which is byte-for-byte the file this scaffolder wrote before.
 */
function mannerSection(input: IdentityScaffoldInput): string {
  const qualities = sanitizeSoulQualities(input.soul);
  if (!hasSoulQualities(qualities)) return "";
  const lines = SOUL_QUALITY_FIELDS.filter((field) => qualities[field.key])
    .map((field) => `- **${field.soulLabel}.** ${qualities[field.key]}`)
    .join("\n");
  return `## My Manner

How I carry the work. This was read from my likeness when I was summoned, and my
person may rewrite any of it.

${lines}

`;
}

export function buildSoulMd(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  const role = prose(input.role, ROLE_MAX, "Familiar");
  const purpose = unterminated(
    prose(
      input.description,
      DESCRIPTION_MAX,
      `support my person with ${role.toLowerCase()} work, within my lane`,
    ),
  );
  return `# SOUL.md — Who I Am

## I am ${name}

I am ${name}, a familiar in this Coven. My purpose is to ${purpose}.

## Purpose

${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. I hold one lane and hold it
well, rather than trying to be everything at once.

${mannerSection(input)}## Core Work

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
  // Same treatment as SOUL.md: `**Role:**` is a field line, and a role carrying
  // a newline would put whatever follows it at the start of a line of its own.
  const role = prose(input.role, ROLE_MAX, "Familiar");
  const creature = creatureForGlyph(input.glyph);
  const purpose = unterminated(
    prose(input.description, DESCRIPTION_MAX, `help my person with ${role.toLowerCase()} work`),
  );
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
