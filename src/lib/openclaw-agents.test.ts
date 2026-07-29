// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeOpenClawAgent } from "./openclaw-agents.ts";

assert.deepEqual(
  summarizeOpenClawAgent(
    "research-lane",
    `# IDENTITY.md - Who Am I?

- **Name:** Riley
- **Creature:** Research Familiar
- **Vibe:** careful and evidence-led
`,
    "/Users/example/.openclaw/workspace/research-lane",
  ),
  {
    id: "research-lane",
    displayName: "Riley",
    role: "Research Familiar",
    workspacePath: "/Users/example/.openclaw/workspace/research-lane",
  },
);

assert.deepEqual(summarizeOpenClawAgent("coven-code", null, null), {
  id: "coven-code",
  displayName: "Coven Code",
  role: "OpenClaw agent",
  workspacePath: null,
});

const route = readFileSync(
  new URL("../app/api/openclaw-agents/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  route,
  /listOpenClawAgents\(\)/,
  "the summoning inventory should use OpenClaw's live registered agents",
);
assert.match(
  route,
  /agent\.workspace\?\.trim\(\) \|\| path\.join\(workspaceRoot, id\)/,
  "registered agents should retain their authoritative workspace path",
);
assert.doesNotMatch(
  route,
  /readdir\(agentsRoot/,
  "stale filesystem-only agent directories must not appear in the summoning inventory",
);
