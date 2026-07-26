// @ts-nocheck
import assert from "node:assert/strict";
import { buildSkillAgentPrompt } from "./skill-agent-prompt.ts";

// The brief must hand a familiar the COMPLETE agentic contract: goal,
// existing-skill discovery, the build body shape, creation-only semantics,
// and the roots table — so a harness session can author a skill with no
// additional context (mirrors craft-agent-prompt).
{
  const prompt = buildSkillAgentPrompt({ description: "  Wrap our deploy checklist.  " });
  assert.match(prompt, /Coven Cave skill/, "names the artifact being built");
  assert.match(prompt, /Wrap our deploy checklist\./, "carries the trimmed operator goal");
  assert.match(prompt, /GET \/api\/skills\/local/, "documents existing-skill discovery");
  assert.match(prompt, /POST \/api\/skills\/build/, "documents the build endpoint");
  assert.match(prompt, /"root": "coven\|claude\|codex\|agents"/, "documents the exact body shape");
  assert.match(prompt, /code: "exists"/, "documents the duplicate refusal");
  assert.match(prompt, /derived server-side/, "forbids picking ids");
  assert.match(prompt, /Only save what the operator approved\./, "consent gate");
  assert.doesNotMatch(prompt, /Preferred destination/, "no root line unless one was provided");
}

// A preferred root rides along when the operator picked one in the form.
{
  const prompt = buildSkillAgentPrompt({ description: "x", root: "codex" });
  assert.match(prompt, /Preferred destination: Codex \(~\/\.codex\/skills\)/, "carries the chosen root");
}

// Unknown roots stay silent rather than inventing a destination.
{
  const prompt = buildSkillAgentPrompt({ description: "x", root: "nope" });
  assert.doesNotMatch(prompt, /Preferred destination/);
}

console.log("skill-agent-prompt: ok");
