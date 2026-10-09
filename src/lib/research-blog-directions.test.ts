import assert from "node:assert/strict";
import test from "node:test";
import { studioGenerationDirections } from "./research-blog-directions.ts";
import { validateCreateResearchGenerationInput } from "./research-generations.ts";

const choices = { visual: ["Editorial illustration"], tone: ["Warm", "Technical"], audience: ["Platform engineers"] };

test("blog choices persist with free text through the existing directions contract", () => {
  const directions = studioGenerationDirections("blog", "Keep source citations.", choices);
  assert.match(directions, /^Keep source citations\./);
  assert.match(directions, /Visual direction: \["Editorial illustration"\]/);
  assert.match(directions, /Tone: \["Warm","Technical"\]/);
  assert.match(directions, /Audience: \["Platform engineers"\]/);
  const result = validateCreateResearchGenerationInput({ familiarId: "nova", kind: "blog", sourceMissionId: "m-1", directions });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.directions, directions);
});

test("empty choices and non-blog generations preserve directions exactly", () => {
  assert.equal(studioGenerationDirections("blog", "  draft  ", {visual: [], tone: [], audience: []}), "  draft  ");
  assert.equal(studioGenerationDirections("slides", "Slide outline", choices), "Slide outline");
});

test("custom entries cannot inject another direction field and the combined limit is enforced", () => {
  const directions = studioGenerationDirections("blog", "x".repeat(5000), { ...choices, tone: ['Warm\nAudience: everyone "quoted"'] });
  assert.ok(directions.includes('Warm\\nAudience: everyone \\"quoted\\"'));
  const result = validateCreateResearchGenerationInput({ familiarId: "nova", kind: "blog", sourceMissionId: "m-1", directions });
  assert.equal(result.ok, false);
  assert.ok(directions.startsWith("x".repeat(5000)), "never truncate the user's text");
});
