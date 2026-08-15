import assert from "node:assert/strict";
import test from "node:test";
import {
  blogGenerationDirectionPrefix,
  composeBlogGenerationDirections,
} from "./research-generation-directions.ts";

test("blog directions serialize visual, tone, and audience selections", () => {
  assert.equal(
    composeBlogGenerationDirections("Lead with the benchmark.", {
      visuals: ["Hero image", "Data chart"],
      tones: ["Analytical", "Concise"],
      audiences: ["Technical leaders", "Practitioners"],
    }),
    [
      "Visual direction: Hero image; Data chart",
      "Tone: Analytical; Concise",
      "Audience: Technical leaders; Practitioners",
      "",
      "Additional direction:",
      "Lead with the benchmark.",
    ].join("\n"),
  );
});

test("blog directions trim, deduplicate, and omit empty sections", () => {
  assert.equal(
    composeBlogGenerationDirections("  ", {
      visuals: ["Pull quote", "Pull quote", " "],
      tones: [" Conversational ", "Conversational"],
      audiences: [],
    }),
    "Visual direction: Pull quote\nTone: Conversational",
  );
});

test("blog direction prefix reserves room for freeform guidance", () => {
  const preferences = {
    visuals: ["Inline illustrations"],
    tones: ["Narrative"],
    audiences: ["General readers"],
  };
  const prefix = blogGenerationDirectionPrefix(preferences);
  assert.equal(
    composeBlogGenerationDirections("Keep every claim cited.", preferences),
    `${prefix}Keep every claim cited.`,
  );
  assert.match(prefix, /Additional direction:\n$/);
});
