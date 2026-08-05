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
 *
 * **A purpose is not a description.** The "My purpose is to …" slot was filled
 * from the familiar's `description` until cave-3rz — and the rite's scry writes
 * that description by looking at the PORTRAIT, so every scried familiar was
 * born declaring a job that was a caption of its own face. The two are now
 * separate fields with separate questions (`src/lib/scry.ts`), the description
 * reaches no contract file at all, and a familiar with no stated purpose gets
 * the generic one rather than a borrowed sentence about how it looks.
 */
import { FAMILIAR_CONTRACT_SPEC_VERSION } from "./familiar-contract.ts";
import {
  hasSoulQualities,
  sanitizeFamiliarPurpose,
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
  /**
   * What the familiar is FOR — the clause that finishes "My purpose is to …".
   *
   * **Not the description.** This slot used to be filled by the familiar's
   * `description`, which the summoning rite's scry produces by describing the
   * PORTRAIT: familiars were being written into existence stating "My purpose
   * is to A faceless, mirror-black figure draped in luminous white folds…" —
   * an image caption in a verb slot, and a contract that passed the validator
   * while saying nothing about the job. The scry now reads a purpose as its own
   * field (`src/lib/scry.ts`); the description feeds the card and the familiar
   * record and reaches no contract file.
   *
   * Absent, empty, or hostile → the generic purpose below, which is the exact
   * text this scaffolder wrote before any of it was read off a likeness.
   */
  purpose?: string;
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

/** Longest role this scaffolder will print into a markdown body. Matches the
 *  bound the scry already applies to the same field; the purpose carries the
 *  contract's own bound (`FAMILIAR_PURPOSE_MAX`). */
const ROLE_MAX = 60;

/**
 * Markdown-safe role.
 *
 * It arrives from the scry (a model reading a picture) or from an API caller,
 * and it lands inside SOUL.md / IDENTITY.md — where a newline plus `## I am`
 * would forge a second declared name and break the cross-file invariant this
 * module promises to hold. `sanitizeInlineText` collapses it to one
 * structure-free line, so an unusable value falls back to the default rather
 * than reshaping the file.
 */
function prose(value: string | undefined, max: number, fallback: string): string {
  return sanitizeInlineText(value, max) || fallback;
}

/**
 * The purpose, ready to print after "My purpose is to".
 *
 * `sanitizeFamiliarPurpose` is the same guard the scry already ran — applied
 * AGAIN here, because this module's promise holds for a hostile API caller
 * exactly as it does for the rite, and because nothing that reaches a contract
 * file may be trusted on the say-so of whoever passed it.
 */
function purposeClause(value: string | undefined, fallback: string): string {
  return unterminated(sanitizeFamiliarPurpose(value) || fallback);
}

/** The purpose is printed mid-sentence ("My purpose is to …."), and a scried
 *  one can arrive as a full sentence. Drop the terminal stop so the template
 *  supplies exactly one. */
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

/**
 * The literal text around each purpose slot, shared by the builders above and
 * the repair below so the two can never drift. A repair that anchored on its
 * own copy of these strings would quietly stop matching the day a template line
 * was reworded, and silently repair nothing.
 */
const PURPOSE_LEAD = "My purpose is to ";
const SOUL_SUMMARY_HEAD = "\n## Purpose\n\n";
const SOUL_SUMMARY_TAIL = ". I hold one lane and hold it\nwell, rather than trying to be everything at once.";
const IDENTITY_PURPOSE_TAIL = ". My strength is staying in my lane and being honest\nabout what I know, what I don't, and what I'm inferring.";
/**
 * IDENTITY.md says the same sentence SOUL.md does — one familiar, one stated
 * purpose. It used to open "I help my person: …" with its own second-class
 * fallback, which only ever read well while a description was standing in the
 * slot; a real purpose after it reads "I help my person: help my person with
 * …". The older lead is still recognised when repairing a file on disk.
 */
const IDENTITY_PURPOSE_LEADS = ["I help my person: ", PURPOSE_LEAD];

/** The purpose a familiar gets when nobody stated one. Exactly what this
 *  scaffolder wrote before any of it was read off a likeness. */
function genericPurpose(role: string): string {
  return `support my person with ${role.toLowerCase()} work, within my lane`;
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function buildSoulMd(input: IdentityScaffoldInput): string {
  const name = contractName(input);
  const role = prose(input.role, ROLE_MAX, "Familiar");
  const purpose = purposeClause(input.purpose, genericPurpose(role));
  return `# SOUL.md — Who I Am

## I am ${name}

I am ${name}, a familiar in this Coven. ${PURPOSE_LEAD}${purpose}.
${SOUL_SUMMARY_HEAD}${sentenceCase(purpose)}${SOUL_SUMMARY_TAIL}

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
  const purpose = purposeClause(input.purpose, genericPurpose(role));
  return `# IDENTITY.md - ${name}

- **Name:** ${name}
- **Creature:** ${creature}
- **Role:** ${role}

## Purpose

${PURPOSE_LEAD}${purpose}${IDENTITY_PURPOSE_TAIL}

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

// ── Repairing a familiar that was already written with a caption ─────────────
//
// Every familiar summoned before this change carries the defect on disk: its
// SOUL.md says "My purpose is to <a sentence about its portrait>". Nothing
// flags it — the contract validator only looks for the WORDS "my purpose is",
// so a caption in that slot passes all five properties, which is exactly why
// three familiars had to read their own files to find it.
//
// These two functions rewrite that slot and NOTHING else, and only on evidence
// that the slot is still the machine-written caption: the text sitting in it
// must match the familiar's recorded description. A person who has rewritten
// their familiar's purpose — or its whole SOUL.md — fails that check and their
// file is returned untouched (`null`), because SOUL.md is on the ward's
// protected surface and a scaffolder is not entitled to edit authored identity.
// They are pure; `scripts/repair-familiar-purpose.ts` is what puts them to work,
// on a person's explicit say-so rather than automatically.

export type PurposeRepairInput = {
  /**
   * The familiar's description as the roster records it — the caption the old
   * scaffolder printed into the purpose slot. Used only as EVIDENCE that the
   * slot is machine-written; it is never written back out.
   */
  description: string;
  /** The purpose to write instead. Empty → the generic purpose for the role,
   *  which is what a familiar with nothing stated should have had all along. */
  purpose?: string;
  role?: string;
};

/**
 * Long enough to hold any caption an older template could have printed — the
 * bound is for matching what is already on disk, not for writing anything.
 */
const CAPTION_SCAN_MAX = 400;

/**
 * Terminal stops and surrounding space are ignored when matching, because the
 * caption on disk was written by several generations of this template: some
 * files carry the description's own full stop AND the template's ("textures..").
 */
function purposeKey(value: string): string {
  return value.replace(/[\s.!?]+$/g, "").trim().toLowerCase();
}

/** SOUL.md with its two caption-purpose slots replaced, or `null` when the file
 *  does not provably still hold the caption this scaffolder wrote. */
export function repairSoulPurpose(text: string, input: PurposeRepairInput): string | null {
  const caption = purposeKey(sanitizeInlineText(input.description, CAPTION_SCAN_MAX));
  if (!caption) return null;
  const role = prose(input.role, ROLE_MAX, "Familiar");
  const purpose = purposeClause(input.purpose, genericPurpose(role));

  const declaration = new RegExp(
    `^(I am .+, a familiar in this Coven\\. ${PURPOSE_LEAD})([^\\n]*)$`,
    "m",
  );
  const declared = declaration.exec(text);
  if (!declared || purposeKey(declared[2] ?? "") !== caption) return null;

  const headAt = text.indexOf(SOUL_SUMMARY_HEAD);
  if (headAt < 0) return null;
  const summaryAt = headAt + SOUL_SUMMARY_HEAD.length;
  const tailAt = text.indexOf(SOUL_SUMMARY_TAIL, summaryAt);
  if (tailAt < 0 || purposeKey(text.slice(summaryAt, tailAt)) !== caption) return null;

  // Summary first, by index, then the declaration by regex — doing it in this
  // order keeps the indices computed above valid.
  const withSummary = `${text.slice(0, summaryAt)}${sentenceCase(purpose)}${text.slice(tailAt)}`;
  return withSummary.replace(declaration, (_match, lead: string) => `${lead}${purpose}.`);
}

/** IDENTITY.md with its caption-purpose slot replaced, or `null`. */
export function repairIdentityPurpose(text: string, input: PurposeRepairInput): string | null {
  const caption = purposeKey(sanitizeInlineText(input.description, CAPTION_SCAN_MAX));
  if (!caption) return null;
  const role = prose(input.role, ROLE_MAX, "Familiar");
  const purpose = purposeClause(input.purpose, genericPurpose(role));

  for (const lead of IDENTITY_PURPOSE_LEADS) {
    const leadAt = text.indexOf(lead);
    if (leadAt < 0) continue;
    const slotAt = leadAt + lead.length;
    const tailAt = text.indexOf(IDENTITY_PURPOSE_TAIL, slotAt);
    if (tailAt < 0 || purposeKey(text.slice(slotAt, tailAt)) !== caption) continue;
    // The lead is rewritten along with the slot: a repaired file should read
    // the way a freshly scaffolded one does, not keep a sentence opener that
    // only worked while a caption was sitting in it.
    return `${text.slice(0, leadAt)}${PURPOSE_LEAD}${purpose}${text.slice(tailAt)}`;
  }
  return null;
}
