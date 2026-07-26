/**
 * Caveman rewrite — the Build tab's terse-mode assist (companion to
 * docs/authoring-assist.md §2). Pure prompt half of a prompt/parse pair on
 * the stitch-sew convention; the parse half is skill-draft's
 * `parseSkillDraftOutput`, reused verbatim (same NAME/DESCRIPTION/TAGS/---
 * contract, TAGS pinned to `none` and ignored by callers — tags are already
 * terse tokens and never rewritten). Parse failure stays a retryable error;
 * the form is only filled with a complete, well-formed rewrite.
 */

export const SKILL_CAVEMAN_INSTRUCTIONS_MAX = 24_000;

export function buildSkillCavemanPrompt(fields: {
  name: string;
  description: string;
  instructions: string;
}): string {
  return [
    "You are rewriting ONE agent skill (a SKILL.md) into CAVEMAN register:",
    "maximally terse, imperative, token-cheap — same meaning, same coverage.",
    "",
    "Rules:",
    "- Strip articles, hedges, courtesies, meta-commentary (no 'please',",
    "  'simply', 'you should', 'make sure to').",
    "- Fragments over sentences. Imperative mood. Keep every fact and step.",
    "- Keep the markdown skeleton: `## ` headings, lists, tables stay.",
    "- Fenced code blocks, inline code, commands, paths, URLs stay VERBATIM.",
    "- DESCRIPTION stays ONE line and keeps its trigger function: an agent",
    "  reading only name + description must still know exactly when to load",
    "  this skill — keep the situations and cue phrases.",
    "- NAME stays a few words.",
    "",
    "Current skill:",
    `NAME: ${fields.name.trim() || "<unnamed>"}`,
    `DESCRIPTION: ${fields.description.trim() || "<none>"}`,
    "INSTRUCTIONS:",
    fields.instructions.trim(),
    "",
    "Respond in EXACTLY this format (no fences, no preamble):",
    "NAME: <caveman name, one line>",
    "DESCRIPTION: <caveman trigger description, one line>",
    "TAGS: none",
    "---",
    "<caveman instructions body as markdown>",
  ].join("\n");
}
