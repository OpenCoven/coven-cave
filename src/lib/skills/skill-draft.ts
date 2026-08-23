/**
 * Skill drafting — the headless "describe → SKILL.md candidate" assist
 * (docs/authoring-assist.md §2, cave-yz8n).
 *
 * Pure prompt + parse pair for the bounded assist runner, the stitch-sew
 * convention: `buildSkillDraftPrompt` and `parseSkillDraftOutput` stay in
 * lockstep, parse failure is a retryable error (never a written file), and
 * the parsed fields land in the Build form for review — the live preview and
 * the creation-only save remain the trust boundary.
 */

import { MAX_SKILL_DESCRIPTION_CHARS, MAX_SKILL_NAME_CHARS } from "./skill-build-format.ts";

export const SKILL_DRAFT_DESCRIPTION_MAX = 2000;

export function buildSkillDraftPrompt(description: string): string {
  return [
    "You are drafting ONE agent skill (a SKILL.md) from an operator's description.",
    "A skill teaches an agent a repeatable procedure or reference. The frontmatter",
    "`description` is the TRIGGER: an agent reading only the name + description must",
    "know exactly when to load this skill — name the situations and cue phrases.",
    "Write the instructions as terse, imperative markdown with `## ` sections",
    "(e.g. When to use / Steps / Verification). No meta-commentary.",
    "",
    "Operator's description of the skill they want:",
    description.trim(),
    "",
    "Respond in EXACTLY this format (no fences, no preamble):",
    "NAME: <skill name, a few words, one line>",
    "DESCRIPTION: <the trigger description, one line>",
    "TAGS: <0-6 comma-separated lowercase tags>",
    "---",
    "<instructions body as markdown>",
  ].join("\n");
}

export type SkillDraftOutput = {
  name: string;
  description: string;
  tags: string[];
  instructions: string;
};

/** Parse the strict draft contract. Returns null when the shape is off —
 *  callers surface that as a retryable failure instead of filling the form
 *  with garbage. Tolerates a whole-response fence exactly like
 *  `parseSewOutput` (anchored + greedy; never unwraps fences INSIDE the body). */
export function parseSkillDraftOutput(text: string): SkillDraftOutput | null {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```[a-z]*\r?\n([\s\S]*)\r?\n```$/, "$1").trim();
  const match = unfenced.match(
    /^NAME:\s*(.+)\r?\nDESCRIPTION:\s*(.+)\r?\nTAGS:\s*(.*)\r?\n---\r?\n([\s\S]*)$/,
  );
  if (!match) return null;
  const name = match[1].trim().slice(0, MAX_SKILL_NAME_CHARS);
  const description = match[2].trim().slice(0, MAX_SKILL_DESCRIPTION_CHARS);
  const instructions = match[4].trim();
  if (!name || !description || !instructions) return null;
  const tags = match[3]
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);
  return { name, description, tags, instructions };
}
