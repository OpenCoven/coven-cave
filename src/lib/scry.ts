/**
 * The scry — reading a familiar out of a likeness.
 *
 * Summoning a familiar today means filling in a form: pick a vessel, type a
 * name, type a role, type a description. A scry lets the picture do that first
 * pass instead. A local harness is handed the staged likeness and asked for one
 * JSON object; everything it returns arrives in the rite as an **editable
 * suggestion**, never a silent commit.
 *
 * This module is the pure half — the contract, the prompt, and the parser. It
 * imports nothing from `node:`, so the rite can reuse the same clamps the
 * server applies (see `src/lib/server/scry-harness.ts` for the spawn and
 * `src/lib/server/scry-likeness.ts` for the untrusted-image intake).
 *
 * Two rules the parser enforces rather than trusts:
 *
 *   1. **Pronouns are never inferred from an image.** The reply is not even
 *      consulted for them; every reading carries `they/them` with
 *      `pronounsInferred: false` so the rite can flag the field for the person
 *      to answer. Guessing gender from a picture is exactly the
 *      confident-wrong-answer this flow would otherwise produce at scale.
 *   2. **The model fills slots; it does not author identity files.** A glyph or
 *      aura is accepted only when it names one of the choices the rite already
 *      offers, so a reading can never introduce a sigil or colour outside the
 *      token system. Everything else is trimmed and length-clamped.
 */

import { SUMMONABLE_LOCAL_HARNESS_IDS } from "./harness-adapters.ts";

/** Ceiling on a posted likeness. Roughly a phone photo at full resolution. */
export const SCRY_MAX_LIKENESS_BYTES = 12 * 1024 * 1024;

/**
 * The runtimes a scry may run on, in the order the rite offers them.
 *
 * This app models one vision-adjacent capability — "can this harness open a
 * local image file", the gate `/api/chat/send` calls `imagesSupported`. It is
 * not a model-modality database, and inventing one here would be a guess
 * dressed as a capability. So the allowlist is the set of runtimes the rite
 * already offers for a local vessel: a runtime the rite cannot summon a
 * familiar onto is not one it should be scrying with, and OpenClaw — which the
 * chat route's own image gate also excludes — is outside it in both places.
 */
export const SCRY_CAPABLE_HARNESS_IDS = SUMMONABLE_LOCAL_HARNESS_IDS;

const SCRY_HARNESS_IDS = new Set<string>(SCRY_CAPABLE_HARNESS_IDS);

/**
 * Whether a harness id may be scried on.
 *
 * Deliberately strict about the id: unlike `isSummonableLocalHarness` this does
 * NOT canonicalize aliases first. The value reaches `coven run <harness>`
 * verbatim, so accepting `hermes-agent` here would spawn a command naming a
 * binary the adapter catalog does not describe. The rite always sends the
 * canonical id it read from `/api/harnesses`; anything else is refused.
 */
export function isScryCapableHarness(harness: unknown): harness is string {
  return typeof harness === "string" && SCRY_HARNESS_IDS.has(harness);
}

/**
 * Likeness types the rite accepts. SVG is deliberately absent for the same
 * reason the avatar route excludes it: workspace-controlled active content.
 */
export const SCRY_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ScryLikenessMime = (typeof SCRY_ACCEPTED_MIME_TYPES)[number];

/** `accept` attribute for the rite's file input. */
export const SCRY_LIKENESS_ACCEPT = SCRY_ACCEPTED_MIME_TYPES.join(",");

export function isScryLikenessMime(value: unknown): value is ScryLikenessMime {
  return (
    typeof value === "string" &&
    (SCRY_ACCEPTED_MIME_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Field ceilings. The rite shows every value in an editable input, so these
 * bound what a harness can paste into the form rather than what a person may
 * eventually type.
 */
export const SCRY_FIELD_LIMITS = {
  name: 48,
  office: 64,
  purpose: 240,
  description: 280,
  manner: 120,
} as const;

/**
 * The manner — how a familiar sounds and reasons. These fill slots in the
 * existing contract scaffolder rather than becoming prose the model authored.
 */
export type ScryManner = {
  voice: string | null;
  temperament: string | null;
  reasoning: string | null;
};

export type ScryReading = {
  name: string | null;
  /** The office a familiar holds — what it is called, e.g. "Code reviewer". */
  office: string | null;
  /** The job, kept separate from the description: a purpose is not a caption. */
  purpose: string | null;
  /** The line that describes the likeness itself. Stays with the card art. */
  description: string | null;
  manner: ScryManner;
  /** One of the glyphs offered to the scry, or null. */
  glyph: string | null;
  /** One of the aura labels offered to the scry, or null. */
  auraLabel: string | null;
  /** Always `they/them` — see the module note. */
  pronouns: "they/them";
  /** Always `false`. Present so the rite can flag the field rather than hide it. */
  pronounsInferred: false;
};

/**
 * Build the instruction handed to the harness.
 *
 * `imagePath` is the server-generated staging path — never a client-supplied
 * name — and is the only place the likeness is referenced. Harnesses in this
 * app read images by opening a local file (the same contract
 * `buildPromptWithAttachments` uses for chat attachments); there is no
 * multimodal message channel here.
 */
export function buildScryInstruction(options: {
  imagePath: string;
  glyphChoices: readonly string[];
  auraChoices: readonly string[];
}): string {
  const glyphs = options.glyphChoices.join(", ");
  const auras = options.auraChoices.join(", ");
  return [
    `Open and look at the image file at ${options.imagePath}.`,
    "",
    "It is a likeness for a software agent — a \"familiar\" — that someone is about to create.",
    "Propose that familiar from what the picture shows.",
    "",
    "Rules:",
    "- Describe the depicted character or creature. Never identify, name, or",
    "  speculate about a real person, and never state or imply anyone's gender,",
    "  age, ethnicity, or pronouns.",
    "- A purpose is a job, not a caption. Keep it separate from the description.",
    "- Reply with ONE JSON object and nothing else. No prose, no code fence.",
    "",
    "Shape:",
    "{",
    '  "name": "a short given name",',
    '  "office": "the role it holds, 1-3 words",',
    '  "purpose": "one sentence naming the work it does",',
    '  "description": "one sentence describing the likeness",',
    '  "voice": "how it speaks",',
    '  "temperament": "how it carries itself",',
    '  "reasoning": "how it works a problem",',
    `  "glyph": "exactly one of: ${glyphs}",`,
    `  "aura": "exactly one of: ${auras}"`,
    "}",
  ].join("\n");
}

function clampText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  // Collapse newlines/tabs so a multi-line reply cannot smuggle layout into a
  // single-line input, then clamp. Trim last so a clamp cannot leave a gap.
  const flattened = value.replace(/\s+/g, " ").trim();
  if (!flattened) return null;
  const clamped = flattened.length > limit ? flattened.slice(0, limit) : flattened;
  const trimmed = clamped.trim();
  return trimmed || null;
}

function pickFromChoices(value: unknown, choices: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return choices.find((choice) => choice.toLowerCase() === needle) ?? null;
}

/**
 * Pull the JSON objects out of harness stdout.
 *
 * Harnesses interleave their own banners, tool chatter, and trailing newlines
 * around whatever they were asked for, so a bare `JSON.parse(raw)` fails on a
 * reply that is perfectly good. This scans for balanced `{...}` spans while
 * respecting string literals and escapes, and returns them innermost-last so
 * the caller can prefer the last complete object — the reply, rather than an
 * earlier echo of the instruction.
 */
function balancedJsonSpans(raw: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        spans.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return spans;
}

/**
 * Parse a harness reply into a reading.
 *
 * Returns `null` when nothing usable came back — which the route reports as a
 * failed scry rather than as an empty familiar. "Usable" means at least a name
 * or a description survived validation: those are the two fields
 * `normalizeFamiliarDraft` refuses to create a familiar without, so a reading
 * with neither would leave the rite exactly where it started.
 */
export function parseScryReading(
  raw: unknown,
  options: { glyphChoices: readonly string[]; auraChoices: readonly string[] },
): ScryReading | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const spans = balancedJsonSpans(raw);
  for (let i = spans.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(spans[i]);
    } catch {
      continue;
    }
    // Narrowing, not validation: every span the scanner yields begins with `{`,
    // so anything that parses at all is an object. (An `Array.isArray` branch
    // stood here and was unreachable for exactly that reason — no reply could
    // make it fire, so it could only ever have reported a catch it never made.)
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;

    const reading: ScryReading = {
      name: clampText(record.name, SCRY_FIELD_LIMITS.name),
      office: clampText(record.office, SCRY_FIELD_LIMITS.office),
      purpose: clampText(record.purpose, SCRY_FIELD_LIMITS.purpose),
      description: clampText(record.description, SCRY_FIELD_LIMITS.description),
      manner: {
        voice: clampText(record.voice, SCRY_FIELD_LIMITS.manner),
        temperament: clampText(record.temperament, SCRY_FIELD_LIMITS.manner),
        reasoning: clampText(record.reasoning, SCRY_FIELD_LIMITS.manner),
      },
      glyph: pickFromChoices(record.glyph, options.glyphChoices),
      auraLabel: pickFromChoices(record.aura, options.auraChoices),
      // Not read from `record` at all — see the module note.
      pronouns: "they/them",
      pronounsInferred: false,
    };

    if (!reading.name && !reading.description) continue;
    return reading;
  }
  return null;
}

/**
 * Fold the manner into the description the familiar is created with.
 *
 * The manner is what a scry adds over typing a description by hand, and
 * `normalizeFamiliarDraft` only persists `description` — so without this the
 * voice/temperament/reasoning a person just approved would be dropped on the
 * way to `SOUL.md`. The purpose leads because a purpose is the job; the manner
 * follows as one sentence.
 */
export function composeScryDescription(reading: ScryReading): string {
  const manner = [reading.manner.voice, reading.manner.temperament, reading.manner.reasoning]
    .filter((part): part is string => Boolean(part));
  const lead = reading.purpose ?? reading.description;
  if (!lead) return manner.join(" ");
  if (manner.length === 0) return lead;
  const sentence = /[.!?]$/.test(lead) ? lead : `${lead}.`;
  return `${sentence} ${manner.join(" ")}`;
}
