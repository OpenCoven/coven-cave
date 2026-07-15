/**
 * Stitch patterns — the shapes a sewn entry can aim for
 * (docs/authoring-assist.md §4, cave-kwx4).
 *
 * A pattern is pure prefill data (the AUTOMATION_TEMPLATES stance): section
 * headings the distilled body should follow plus tag hints. Selecting one
 * parameterizes the sew prompt and the manual-sew scaffold — the sew output
 * contract itself (`TITLE:/TAGS:/---/body`) is untouched, so `parseSewOutput`
 * needs no changes. No pattern selected = today's freeform sew.
 */

export type StitchPattern = {
  id: string;
  name: string;
  /** One-line hint shown in the picker and folded into the sew prompt. */
  description: string;
  /** `## ` section headings the sewn body should follow, in order. */
  bodyScaffold: readonly string[];
  /** Tags prefilled on manual sews and suggested to the distiller. */
  tagHints: readonly string[];
};

export const STITCH_PATTERNS: readonly StitchPattern[] = [
  {
    id: "glossary",
    name: "Glossary entry",
    description: "A term defined precisely, with usage and neighbors.",
    bodyScaffold: ["Definition", "Usage", "Related terms"],
    tagHints: ["glossary"],
  },
  {
    id: "api-contract",
    name: "API contract",
    description: "Endpoints, shapes, and limits as authoritative reference.",
    bodyScaffold: ["Overview", "Endpoints", "Request & response shapes", "Errors & limits"],
    tagHints: ["api", "contract"],
  },
  {
    id: "decision-record",
    name: "Decision record",
    description: "What was decided, why, and what it forecloses.",
    bodyScaffold: ["Context", "Decision", "Consequences", "Alternatives considered"],
    tagHints: ["decision"],
  },
  {
    id: "how-to",
    name: "How-to",
    description: "A repeatable procedure with verification.",
    bodyScaffold: ["When to use", "Prerequisites", "Steps", "Verification"],
    tagHints: ["how-to"],
  },
];

export function stitchPatternById(id: unknown): StitchPattern | null {
  if (typeof id !== "string" || !id) return null;
  return STITCH_PATTERNS.find((pattern) => pattern.id === id) ?? null;
}
