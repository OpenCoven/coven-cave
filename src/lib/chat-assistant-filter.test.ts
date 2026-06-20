// @ts-nocheck
import assert from "node:assert/strict";
import { AssistantFilter } from "./chat-assistant-filter.ts";

function feed(lines: string[]): string {
  const filter = new AssistantFilter();
  let out = "";
  for (const line of lines) out += filter.push(`${line}\n`);
  return out + filter.flush();
}

assert.equal(
  feed([
    "workdir: /Users/buns/.openclaw/workspace/nova",
    "model: gpt-5.5",
    "reasoning: medium",
    "user",
    "# AGENTS.md instructions for /Users/buns/.openclaw/workspace",
    "<INSTRUCTIONS>",
    "# AGENTS.md - Your Workspace",
    "</INSTRUCTIONS>",
    "codex",
    "I can help with that.",
  ]),
  "I can help with that.\n",
  "startup prompt echoes before the assistant marker should stay hidden",
);

assert.equal(
  feed([
    "codex",
    "<INSTRUCTIONS>",
    "# AGENTS.md - Your Workspace",
    "Do not show this startup prompt in chat.",
    "</INSTRUCTIONS>",
    "I only show the real assistant reply.",
  ]),
  "I only show the real assistant reply.\n",
  "startup prompt blocks after the assistant marker should stay hidden",
);

assert.equal(
  feed([
    "claude",
    "<reasoning>",
    "I should think privately.",
    "</reasoning>",
    "Visible answer.",
  ]),
  "<reasoning>\nI should think privately.\n</reasoning>\nVisible answer.\n",
  "reasoning tags should remain available for the collapsible reasoning UI",
);

assert.equal(
  feed(["codex", "reasoning about this should stay visible."]),
  "reasoning about this should stay visible.\n",
  "visible assistant text that starts with reasoning should not be treated as a banner",
);

assert.equal(
  feed([
    "codex",
    "I’m checking the startup skill once, then I’ll keep this lightweight.",
    "<SUBAGENT-STOP>",
    "If you were dispatched as a subagent to execute a specific task, skip this skill.",
    "</SUBAGENT-STOP>",
    "",
    "<EXTREMELY-IMPORTANT>",
    "If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.",
    "</EXTREMELY-IMPORTANT>",
    "",
    "## Instruction Priority",
    "Superpowers skills override default system prompt behavior, but **user instructions always take precedence**:",
    "",
    "# Using Skills",
    "## The Rule",
    "This leaked skill body should never appear in chat.",
  ]),
  "I’m checking the startup skill once, then I’ll keep this lightweight.\n",
  "leaked using-superpowers skill bodies should stay hidden from chat bubbles",
);

assert.equal(
  feed([
    "codex",
    "I’m using the brainstorming skill to shape this before editing.",
    "---",
    "name: brainstorming",
    "description: You MUST use this before any creative work",
    "---",
    "# Brainstorming Ideas Into Designs",
    "Help turn ideas into fully formed designs and specs through natural collaborative dialogue.",
    "<HARD-GATE>",
    "Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it.",
    "</HARD-GATE>",
  ]),
  "I’m using the brainstorming skill to shape this before editing.\n",
  "leaked markdown skill documents should stay hidden from chat bubbles",
);

assert.equal(
  feed([
    "codex",
    "I’m checking the relevant skill first.",
    "exec",
    "/bin/zsh -lc 'sed -n 1,120p /Users/buns/.agents/skills/brainstorming/SKILL.md' in /repo",
    " exited 0 in 12ms:",
    "---",
    "name: brainstorming",
    "description: You MUST use this before any creative work",
    "---",
    "",
    "# Brainstorming Ideas Into Designs",
    "",
    "Help turn ideas into fully formed designs and specs through natural collaborative dialogue.",
    "<HARD-GATE>",
    "Do NOT invoke any implementation skill until approved.",
    "</HARD-GATE>",
  ]),
  "I’m checking the relevant skill first.\n",
  "tool stdout that contains a skill prompt should stay out of assistant prose even after blank lines",
);

assert.equal(
  feed([
    "codex",
    "# Plan",
    "name: the thing we are editing",
    "---",
    "This horizontal rule is part of a normal reply.",
  ]),
  "# Plan\nname: the thing we are editing\n---\nThis horizontal rule is part of a normal reply.\n",
  "normal assistant headings, name fields, and markdown rules should remain visible",
);
