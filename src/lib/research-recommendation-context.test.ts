import assert from "node:assert/strict";
import test from "node:test";

import type { SavedLink } from "./link-organizer.ts";
import { RESEARCH_INTENT_MAX_LENGTH } from "./research-missions.ts";
import type { ResearchMission } from "./research-missions.ts";
import {
  buildResearchRecommendationContext,
  researchRecommendationContextKey,
} from "./research-recommendation-context.ts";

function mission(id: string, intent: string): ResearchMission {
  return {
    id,
    title: `Decision ${id}`,
    intent,
    status: "running",
    updatedAt: `2026-08-19T10:${id.padStart(2, "0")}:00.000Z`,
    sources: [{
      id: `source-${id}`,
      title: `Source ${id}`,
      sourceType: "web",
      status: "used",
      claim: `Claim ${id}`,
    }],
    artifacts: [],
  } as unknown as ResearchMission;
}

function link(id: string): SavedLink {
  return {
    id,
    title: `Source ${id}`,
    url: `https://example.test/${id}`,
    category: "article",
    source: "desk",
    addedAt: "2026-08-19T10:00:00.000Z",
  };
}

test("bounds and compacts long mission and link context before fingerprinting", () => {
  const longIntent = "x".repeat(RESEARCH_INTENT_MAX_LENGTH);
  const missions = Array.from({ length: 30 }, (_, index) => mission(String(index), longIntent));
  const links = Array.from({ length: 30 }, (_, index) => link(String(index)));

  const context = buildResearchRecommendationContext("researcher", missions, links);
  const key = researchRecommendationContextKey(context);

  assert.equal(context.missions.length, 12);
  assert.equal(context.links.length, 12);
  assert.equal(key.includes(longIntent), false);
  assert.doesNotThrow(() => JSON.stringify(context));
});

test("context fingerprints react to familiar and source evidence revisions", () => {
  const firstMission = mission("1", "Compare retrieval systems.");
  const changedSourceMission = {
    ...firstMission,
    sources: [{ ...firstMission.sources[0]!, claim: "A newly revised benchmark claim." }],
  };

  const first = buildResearchRecommendationContext("researcher-a", [firstMission], [link("1")]);
  const sourceChanged = buildResearchRecommendationContext("researcher-a", [changedSourceMission], [link("1")]);
  const familiarChanged = buildResearchRecommendationContext("researcher-b", [firstMission], [link("1")]);

  assert.notEqual(researchRecommendationContextKey(first), researchRecommendationContextKey(sourceChanged));
  assert.notEqual(researchRecommendationContextKey(first), researchRecommendationContextKey(familiarChanged));
});

console.log("research recommendation context tests passed");
