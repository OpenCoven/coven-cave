/**
 * familiar-soul — the qualities a SOUL.md is actually about (cave-3rz.3).
 *
 * A scaffolded SOUL.md used to be the same file for every familiar: name and
 * role interpolated into a fixed template, so two familiars summoned from two
 * completely different likenesses read identically. The scry already looks at
 * the image; this module is the vocabulary it answers in — **voice**,
 * **temperament**, **reasoning** — and the one sanitiser standing between the
 * model's words and a markdown file on disk.
 *
 * Three rules shape it, and they are the reason this is a module rather than
 * three string fields:
 *
 *  1. **The model fills slots; it never authors the file.** A quality is a
 *     short descriptive clause that lands after a fixed label on a line the
 *     template owns. It cannot open a section, start a list, or reach a line of
 *     its own — see `buildSoulMd` in `familiar-identity-scaffold.ts`, where
 *     every interpolation site is preceded by literal text on the same line.
 *  2. **Sanitising happens where the file is built, not where it is typed.**
 *     `buildSoulMd` calls `sanitizeSoulQualities` itself, so the contract
 *     invariant holds for a hostile API caller exactly as it does for the rite.
 *     Anything the surface does here is a convenience, never the guarantee.
 *  3. **Nothing is inferred about a person.** These describe a character in a
 *     picture. Pronouns stay refused (see `src/lib/scry.ts`); so does anything
 *     that reads as a claim about a real human.
 *
 * Everything degrades to `""`. A missing, unusable, or hostile quality is not
 * an error — it is a template that stays generic, which is exactly today's
 * behaviour.
 */

export const SOUL_QUALITY_KEYS = ["voice", "temperament", "reasoning"] as const;

export type SoulQualityKey = (typeof SOUL_QUALITY_KEYS)[number];

/** All three keys are always present; an absent quality is `""`, never undefined. */
export type FamiliarSoulQualities = Record<SoulQualityKey, string>;

/**
 * A quality is a clause, not a paragraph. Long enough for "dry and unhurried,
 * with a fondness for the exact noun", short enough that no model can smuggle a
 * document through it.
 */
export const SOUL_QUALITY_MAX = 160;

/** Below this a "quality" is punctuation or a stray letter, not a description. */
const SOUL_QUALITY_MIN = 3;

/**
 * One place that knows what each quality means: the scry prompt asks with
 * `ask`, the rite labels the field with `label` and `hint`, and SOUL.md prints
 * `soulLabel`. Three surfaces, one vocabulary.
 */
export const SOUL_QUALITY_FIELDS: ReadonlyArray<{
  key: SoulQualityKey;
  /** Field label in the rite. */
  label: string;
  /** Placeholder in the rite — an example, so the shape is obvious. */
  hint: string;
  /** How SOUL.md names it. */
  soulLabel: string;
  /** What the harness is asked for, one line of the scry prompt. */
  ask: string;
}> = [
  {
    key: "voice",
    label: "Voice",
    hint: "how it sounds when it speaks",
    soulLabel: "Voice",
    ask: "how this figure would SOUND when it speaks — cadence, register, habits of phrasing.",
  },
  {
    key: "temperament",
    label: "Temperament",
    hint: "what it is like to work with",
    soulLabel: "Temperament",
    ask: "its disposition — what it is like to work beside, what it is patient or impatient with.",
  },
  {
    key: "reasoning",
    label: "How it reasons",
    hint: "how it works a problem",
    soulLabel: "How I reason",
    ask: "how it works a problem — where it starts, what it trusts, what it checks twice.",
  },
];

export function emptySoulQualities(): FamiliarSoulQualities {
  return { voice: "", temperament: "", reasoning: "" };
}

/** True when at least one quality survived and is worth writing down. */
export function hasSoulQualities(qualities: FamiliarSoulQualities | null | undefined): boolean {
  if (!qualities) return false;
  return SOUL_QUALITY_KEYS.some((key) => qualities[key].length > 0);
}

/**
 * Shapes that could forge the structure of a contract file.
 *
 * Matched against the RAW value and rejecting the whole quality rather than
 * editing it down: a reply trying to write a `## I am` heading or a ward
 * invariant is not a quality with some markdown in it, and silently keeping the
 * remainder would be trusting the half of it we happened to strip.
 *
 * The character strip below already makes every one of these inert. This is the
 * second lock — the file's shape is the contract, and a validator that reads
 * line-first deserves an input that cannot produce a line.
 */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  /^[ \t]{0,8}#{1,6}[ \t]/m, //                       a markdown heading
  /^[ \t]{0,8}(?:-{3,}|={3,}|\*{3,}|_{3,})[ \t]*$/m, // a rule or setext underline
  /^[ \t]{0,8}```/m, //                               a code fence
  /\[(?:meta|protected|editable|approval_tiers)[\].]/i, // a ward section header
  /\bfamiliar\.(?:name|person)[ \t]*==/i, //           a ward invariant
  /^[ \t]{0,8}(?:version|familiar|person|files|invariants|paths|blocks|gate)[ \t]*=/im, // a ward assignment
  /\*\*(?:name|creature|role)[ \t]*:\*\*/i, //         an IDENTITY.md field
];

/** Characters that mean something structural in markdown or TOML. */
const STRUCTURAL = /[#*_`~|<>[\]{}\\]/g;
/** Every control character, newline and tab included — a quality is one line. */
const CONTROL = /[\u0000-\u001f\u007f]/g;
/** Bullets, blockquote marks and dashes that would open a list at line start. */
const LEADING_MARKS = /^[\s\-+•·>»–—]+/;
const WRAPPING_QUOTES = /^["'“”‘’]+|["'“”‘’]+$/g;

/**
 * Any model-supplied string, made safe to interpolate into a markdown file:
 * one line, no structural characters, bounded.
 *
 * Used for the qualities below and — since the scry writes those too — for the
 * role and description the scaffolder has always interpolated. Returns `""` for
 * anything unusable, which every caller reads as "there is no such value" and
 * answers with its own default.
 */
export function sanitizeInlineText(value: unknown, max = SOUL_QUALITY_MAX): string {
  if (typeof value !== "string") return "";
  if (DIRECTIVE_PATTERNS.some((pattern) => pattern.test(value))) return "";

  // One line only. A model that answered in paragraphs contributes its first
  // sentence rather than its structure.
  const firstLine = value.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const bare = firstLine
    .replace(CONTROL, " ")
    .replace(STRUCTURAL, "")
    .replace(LEADING_MARKS, "")
    .replace(WRAPPING_QUOTES, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare) return "";
  return bare.length > max ? `${bare.slice(0, max - 1).trimEnd()}…` : bare;
}

/**
 * One quality, made safe to interpolate into a markdown file.
 *
 * Returns `""` for anything unusable — a non-string, a directive attempt, or
 * text that sanitises down to nothing. Callers treat `""` as "this familiar has
 * no such quality", which is the generic template and a perfectly good outcome.
 */
export function sanitizeSoulQuality(value: unknown): string {
  const text = sanitizeInlineText(value, SOUL_QUALITY_MAX);
  // A one- or two-character "quality" is punctuation that survived the strip,
  // not a description of anything.
  return text.length >= SOUL_QUALITY_MIN ? text : "";
}

/**
 * Read a whole set of qualities out of an unknown value (a parsed harness
 * reply, a request body, a component's state). Never throws; every key is
 * present in the result.
 */
export function sanitizeSoulQualities(value: unknown): FamiliarSoulQualities {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const qualities = emptySoulQualities();
  for (const key of SOUL_QUALITY_KEYS) {
    qualities[key] = sanitizeSoulQuality(source[key]);
  }
  return qualities;
}
