import assert from "node:assert/strict";
import {
  caveAgenticRecommendations,
  caveResearchContextPacks,
  caveResearchHostedRuns,
  caveResearchLocalIngestion,
  caveResearchResources,
  caveResearchSemantic,
  caveResearchTopicDiscovery,
} from "./feature-flags.ts";

const original = process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;
const researchFlagNames = [
  "NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES",
  "NEXT_PUBLIC_CAVE_RESEARCH_LOCAL_INGESTION",
  "NEXT_PUBLIC_CAVE_RESEARCH_SEMANTIC",
  "NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS",
  "NEXT_PUBLIC_CAVE_RESEARCH_TOPIC_DISCOVERY",
  "NEXT_PUBLIC_CAVE_RESEARCH_HOSTED_RUNS",
] as const;
const originalResearchFlags = Object.fromEntries(
  researchFlagNames.map((name) => [name, process.env[name]]),
) as Record<(typeof researchFlagNames)[number], string | undefined>;

function clearResearchFlags(): void {
  for (const name of researchFlagNames) delete process.env[name];
}

try {
  delete process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;
  assert.equal(caveAgenticRecommendations(), false, "agentic recommendations default off");

  for (const enabled of ["1", "true", "yes", "on", " ON "]) {
    process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = enabled;
    assert.equal(caveAgenticRecommendations(), true, `${enabled} enables agentic recommendations`);
  }

  for (const disabled of ["0", "false", "no", "off", "enabled"]) {
    process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = disabled;
    assert.equal(caveAgenticRecommendations(), false, `${disabled} does not enable agentic recommendations`);
  }

  clearResearchFlags();
  assert.equal(caveResearchResources(), false, "resources default off");
  assert.equal(caveResearchLocalIngestion(), false, "local ingestion defaults off");
  assert.equal(caveResearchSemantic(), false, "semantic defaults off");
  assert.equal(caveResearchContextPacks(), false, "Context Packs default off");
  assert.equal(caveResearchTopicDiscovery(), false, "Topic Discovery defaults off");
  assert.equal(caveResearchHostedRuns(), false, "hosted runs default off");

  for (const enabled of ["1", "true", "yes", "on", " ON "]) {
    clearResearchFlags();
    process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES = enabled;
    assert.equal(caveResearchResources(), true, `${enabled} enables Research Resources`);
  }

  for (const disabled of ["0", "false", "no", "off", "enabled", ""]) {
    clearResearchFlags();
    process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES = disabled;
    assert.equal(caveResearchResources(), false, `${disabled || "empty"} does not enable Research Resources`);
  }

  clearResearchFlags();
  process.env.NEXT_PUBLIC_CAVE_RESEARCH_LOCAL_INGESTION = "1";
  process.env.NEXT_PUBLIC_CAVE_RESEARCH_SEMANTIC = "1";
  process.env.NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS = "1";
  process.env.NEXT_PUBLIC_CAVE_RESEARCH_TOPIC_DISCOVERY = "1";
  assert.equal(caveResearchLocalIngestion(), false, "ingestion requires resources");
  assert.equal(caveResearchSemantic(), false, "semantic requires ingestion and resources");
  assert.equal(caveResearchContextPacks(), false, "Context Packs require resources");
  assert.equal(caveResearchTopicDiscovery(), false, "Topic Discovery requires Context Packs and resources");

  process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES = "1";
  assert.equal(caveResearchLocalIngestion(), true);
  assert.equal(caveResearchSemantic(), true);
  assert.equal(caveResearchContextPacks(), true);
  assert.equal(caveResearchTopicDiscovery(), true);

  delete process.env.NEXT_PUBLIC_CAVE_RESEARCH_LOCAL_INGESTION;
  assert.equal(caveResearchSemantic(), false, "semantic stays off when ingestion is off");
  assert.equal(caveResearchContextPacks(), true, "Context Packs do not require ingestion");
  assert.equal(caveResearchTopicDiscovery(), true, "Topic Discovery follows Context Packs");

  delete process.env.NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS;
  assert.equal(caveResearchTopicDiscovery(), false, "Topic Discovery stays off without Context Packs");

  clearResearchFlags();
  process.env.NEXT_PUBLIC_CAVE_RESEARCH_HOSTED_RUNS = "1";
  assert.equal(caveResearchHostedRuns(), false, "public hosted intent cannot prove C0 readiness");

  delete process.env.NEXT_PUBLIC_CAVE_RESEARCH_HOSTED_RUNS;
  assert.equal(caveResearchHostedRuns(), false, "hosted runs remain off without a C0 server authority");
} finally {
  if (original === undefined) delete process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;
  else process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = original;
  for (const name of researchFlagNames) {
    const value = originalResearchFlags[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("feature-flags.test.ts: ok");
