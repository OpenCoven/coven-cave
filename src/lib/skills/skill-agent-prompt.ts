// Agentic skill building (cave-yz8n): the brief a familiar receives when the
// operator wants to build a skill in chat instead of the Build form. Carries
// the complete local API contract — mirrors craft-agent-prompt.ts and the
// agent entry point documented in .agents/skills/skill-builder/SKILL.md.

import { SKILL_BUILD_ROOTS } from "./skill-build-format.ts";

export type SkillAgentPromptInput = {
  /** The operator's natural-language goal for the skill. */
  description: string;
  /** Optional preferred destination root id (coven/claude/codex/agents). */
  root?: string;
};

export function buildSkillAgentPrompt({ description, root }: SkillAgentPromptInput): string {
  const goal = description.trim();
  const preferred = SKILL_BUILD_ROOTS.find((entry) => entry.id === root);
  return [
    "Build a Coven Cave skill — a SKILL.md that teaches familiars a repeatable procedure or reference — together with the operator, then save it through the local Cave API.",
    "",
    "Operator's goal for this skill:",
    goal,
    ...(preferred ? ["", `Preferred destination: ${preferred.label} (${preferred.pathHint})`] : []),
    "",
    "Build it through the local Cave API (loopback HTTP on this machine, no auth):",
    "1. Check what exists: `GET /api/skills/local` → installed skills; avoid duplicating a slug or a trigger that already fires.",
    "2. Draft with the operator: a name (a few words), a one-line trigger `description` (an agent reading only name + description must know when to load it), 0-6 lowercase tags, and terse imperative instructions with `## ` sections (When to use / Steps / Verification).",
    "3. Save it: `POST /api/skills/build` with JSON `{ \"name\": \"…\", \"description\": \"…\", \"instructions\": \"…\", \"root\": \"coven|claude|codex|agents\", \"tags\": [\"…\"] }` → `{ ok, slug, path }`.",
    "4. Report back: the written path, the slug, and the trigger description you settled on.",
    "",
    "Constraints:",
    "- The route is creation-only: a duplicate slug is refused with `code: \"exists\"` (409) — pick a new name rather than overwriting.",
    "- The slug is derived server-side from the name (lowercase kebab); you don't pick ids.",
    "- Roots: coven → ~/.coven/skills (every familiar), claude → ~/.claude/skills, codex → ~/.codex/skills, agents → ~/.agents/skills. Default to coven unless the operator says otherwise.",
    "- Only save what the operator approved.",
  ].join("\n");
}
