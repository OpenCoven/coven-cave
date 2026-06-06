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
