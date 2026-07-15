/**
 * Skill dry-run — prove a skill fires (and is followable) before shipping it
 * (docs/authoring-assist.md §3, cave-cyfc).
 *
 * Two pure prompt + parse pairs for the bounded assist runner:
 *
 *  - **Trigger check** — given ONLY the frontmatter (name + description) and a
 *    scenario, would an agent load this skill? The description is the trigger;
 *    this is the cheap, honest test of it.
 *  - **Walkthrough check** — the model executes the instructions against the
 *    scenario IN NARRATION ONLY and reports steps it couldn't follow.
 *    Advisory; never gates a save.
 */

export const DRY_RUN_SCENARIO_MAX = 500;

export function buildSkillTriggerCheckPrompt(input: {
  name: string;
  description: string;
  scenario: string;
}): string {
  return [
    "You are an agent deciding whether to load a skill. You can see ONLY the",
    "skill's frontmatter below and the scenario. Decide strictly from the",
    "description — if it does not clearly cover the scenario, the skill does",
    "not fire. No benefit of the doubt: a vague description is a miss.",
    "",
    `Skill name: ${input.name.trim()}`,
    `Skill description: ${input.description.trim()}`,
    "",
    `Scenario: ${input.scenario.trim()}`,
    "",
    "Respond in EXACTLY this format (no fences, no preamble):",
    "FIRES: <yes|no>",
    "REASON: <one line: which words in the description decided it>",
  ].join("\n");
}

export type TriggerCheckOutput = {
  fires: boolean;
  reason: string;
};

export function parseTriggerCheckOutput(text: string): TriggerCheckOutput | null {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```[a-z]*\r?\n([\s\S]*)\r?\n```$/, "$1").trim();
  const match = unfenced.match(/^FIRES:\s*(yes|no)\s*\r?\nREASON:\s*(.+)\s*$/i);
  if (!match) return null;
  const reason = match[2].trim();
  if (!reason) return null;
  return { fires: match[1].toLowerCase() === "yes", reason };
}

export function buildSkillWalkthroughPrompt(input: {
  name: string;
  description: string;
  instructions: string;
  scenario: string;
}): string {
  return [
    "You are dry-running a skill IN NARRATION ONLY — you have no tools and",
    "must not pretend to execute anything. Walk the instructions against the",
    "scenario step by step and report where they are ambiguous, impossible to",
    "follow, missing a prerequisite, or silent about verification.",
    "",
    `Skill name: ${input.name.trim()}`,
    `Skill description: ${input.description.trim()}`,
    "",
    "Instructions:",
    input.instructions.trim(),
    "",
    `Scenario: ${input.scenario.trim()}`,
    "",
    "Respond in EXACTLY this format (no fences, no preamble):",
    "FOLLOWED: <yes|partial|no>",
    "NOTES:",
    "- <one issue or confirmation per line, 1-6 lines>",
  ].join("\n");
}

export type WalkthroughOutput = {
  followed: "yes" | "partial" | "no";
  notes: string[];
};

export function parseWalkthroughOutput(text: string): WalkthroughOutput | null {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```[a-z]*\r?\n([\s\S]*)\r?\n```$/, "$1").trim();
  const match = unfenced.match(/^FOLLOWED:\s*(yes|partial|no)\s*\r?\nNOTES:\s*\r?\n([\s\S]+)$/i);
  if (!match) return null;
  const notes = match[2]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+\S)\s*$/)?.[1])
    .filter((note): note is string => Boolean(note))
    .slice(0, 6);
  if (notes.length === 0) return null;
  return { followed: match[1].toLowerCase() as WalkthroughOutput["followed"], notes };
}
