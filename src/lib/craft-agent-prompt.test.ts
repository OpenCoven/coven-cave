// @ts-nocheck
import assert from "node:assert/strict";
import { buildCraftAgentPrompt } from "./craft-agent-prompt.ts";

// The prompt must hand a familiar the COMPLETE agentic contract: goal, role
// discovery, draft creation, plan verification, and reporting — so a harness
// session can build a Craft with no additional context.
{
  const prompt = buildCraftAgentPrompt({ description: "  Bundle my research reviewer workflow.  " });
  assert.match(prompt, /Coven Cave Craft/, "names the artifact being built");
  assert.match(prompt, /Bundle my research reviewer workflow\./, "carries the trimmed operator goal");
  assert.match(prompt, /GET \/api\/roles/, "documents role discovery");
  assert.match(prompt, /POST \/api\/marketplace\/crafts\/drafts/, "documents draft creation");
  assert.match(prompt, /"familiar": "<id>", "roleIds": \["\.\.\."\]/, "documents the exact draft body shape");
  assert.match(prompt, /GET \/api\/marketplace\/crafts\/plan\?id=<draft\.plugin\.id>/, "documents plan verification");
  assert.match(prompt, /smallest set of its role ids/, "steers toward a minimal bundle");
  assert.match(prompt, /do not force a draft/, "tells the agent to decline when nothing fits");
  assert.match(prompt, /Never invent role ids/, "forbids fabricated role ids");
  assert.doesNotMatch(prompt, /Preferred familiar/, "no familiar line unless one was provided");
}

// A preferred familiar rides along when the operator names one.
{
  const prompt = buildCraftAgentPrompt({ description: "Ship reviews", familiar: "cody" });
  assert.match(prompt, /Preferred familiar: cody/, "carries the preferred familiar");
}

console.log("craft-agent-prompt: ok");
