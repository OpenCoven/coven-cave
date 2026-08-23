import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIEF_QUESTION_MIN_LENGTH,
  EMPTY_RESEARCH_BRIEF,
  RESEARCH_BRIEF_FIELDS,
  assembleBrief,
  builderCoach,
  parseBrief,
  promptRecommendations,
  promptStrength,
} from "./research-prompt-brief";
import type { ResearchMission } from "./research-missions";

function mission(patch: Partial<ResearchMission> & Pick<ResearchMission, "id" | "title">): ResearchMission {
  return {
    version: 1,
    familiarId: "fam-1",
    intent: patch.title,
    mode: "brief",
    modeSource: "auto",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "running",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
    ...patch,
  } as ResearchMission;
}

test("assembleBrief emits only the elements that carry text", () => {
  assert.equal(assembleBrief(EMPTY_RESEARCH_BRIEF), "");
  assert.equal(assembleBrief({ question: "Why do loops stall?" }), "Why do loops stall?");
  assert.equal(
    assembleBrief({ question: "Why do loops stall?", goal: "decide a fix", sources: "primary only" }),
    "Why do loops stall?\ngoal: decide a fix\nsources: primary only",
  );
});

test("parseBrief round-trips anything assembleBrief produced", () => {
  const brief = {
    question: "Compare checkpoint placements",
    goal: "decide review-gate placement",
    constraint: "recent sources only",
    deliverable: "comparison matrix",
    sources: "independent evaluations first",
  };
  assert.deepEqual(parseBrief(assembleBrief(brief)), brief);
});

test("parseBrief treats hand-typed prose as the question, not as nothing", () => {
  const parsed = parseBrief("Just a sentence someone typed.\nAnd a second line.");
  assert.equal(parsed.question, "Just a sentence someone typed.\nAnd a second line.");
  assert.equal(parsed.goal, "");
});

test("parseBrief keeps multi-line questions above the first prefixed line", () => {
  const parsed = parseBrief("Line one\nLine two\ngoal: decide\nsources: arxiv");
  assert.equal(parsed.question, "Line one\nLine two");
  assert.equal(parsed.goal, "decide");
  assert.equal(parsed.sources, "arxiv");
});

test("promptStrength scores zero on an empty draft and five on a full brief", () => {
  assert.equal(promptStrength("").score, 0);
  assert.equal(promptStrength("   ").tone, "sparse");
  const full = assembleBrief({
    question: "Which retry budget holds up?",
    goal: "decide the budget",
    constraint: "primary sources only",
    deliverable: "comparison matrix",
    sources: "independent evaluations first",
  });
  const strength = promptStrength(full);
  assert.equal(strength.score, 5);
  assert.equal(strength.tone, "strong");
  assert.deepEqual(strength.missing, []);
});

test("promptStrength credits well-formed prose that never used the builder", () => {
  // A question mark counts as a goal; "only" as a constraint; "report" as a
  // deliverable; "primary source" as a preference — the meter coaches, it does
  // not enforce the builder's syntax.
  const strength = promptStrength(
    "Which retry budget holds up under load? Use only primary sources and give me a cited report.",
  );
  assert.equal(strength.score, 5);
});

test("promptStrength names what is missing, in assembly order", () => {
  const strength = promptStrength("A question long enough to count.");
  assert.ok(strength.parts[0].present, "question present");
  assert.deepEqual(strength.missing, ["goal", "constraints", "deliverable", "source prefs"]);
  assert.match(strength.tip, /1 of 5/);
});

test("a draft shorter than the intake minimum scores no question element", () => {
  const short = "x".repeat(BRIEF_QUESTION_MIN_LENGTH - 1);
  assert.equal(promptStrength(short).parts[0].present, false);
});

test("every brief field has a badge and only the question lacks starter chips", () => {
  assert.equal(RESEARCH_BRIEF_FIELDS.length, 5);
  for (const field of RESEARCH_BRIEF_FIELDS) {
    assert.match(field.badge, /^0[1-5]$/);
  }
  assert.equal(RESEARCH_BRIEF_FIELDS[0].key, "question");
  assert.equal(RESEARCH_BRIEF_FIELDS[0].chips.length, 0, "no canned research questions");
  for (const field of RESEARCH_BRIEF_FIELDS.slice(1)) {
    assert.ok(field.chips.length > 0, `${field.key} offers starters`);
  }
});

test("builderCoach changes voice as the brief fills", () => {
  assert.notEqual(builderCoach(0), builderCoach(2));
  assert.notEqual(builderCoach(2), builderCoach(5));
});

test("promptRecommendations returns nothing without missions", () => {
  assert.deepEqual(promptRecommendations([]), []);
});

test("promptRecommendations derives one card per real signal, each explaining itself", () => {
  const recs = promptRecommendations([
    mission({ id: "m1", title: "Stopped sweep", status: "failed" }),
    mission({ id: "m2", title: "Waiting run", status: "checkpoint" }),
    mission({ id: "m3", title: "Finished run", status: "completed" }),
  ]);
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map((rec) => rec.tone), ["danger", "warning", "success"]);
  for (const rec of recs) {
    assert.ok(rec.why.length > 0, "every card explains why it is offered");
    assert.ok(rec.brief.question.length > 0, "every card loads a question");
  }
});

test("promptRecommendations flags a run short of its source target", () => {
  const thin = mission({
    id: "m4",
    title: "Thin run",
    status: "running",
    sources: [
      { id: "s1", title: "One", status: "used" },
      { id: "s2", title: "Two", status: "used" },
    ] as ResearchMission["sources"],
  });
  const recs = promptRecommendations([thin]);
  assert.equal(recs.length, 1);
  assert.match(recs[0].why, /2 of 6 sources/);
});

test("promptRecommendations ignores archived missions and honours the limit", () => {
  assert.deepEqual(promptRecommendations([mission({ id: "m5", title: "Old", status: "archived" })]), []);
  const recs = promptRecommendations(
    [
      mission({ id: "m1", title: "Stopped", status: "failed" }),
      mission({ id: "m2", title: "Waiting", status: "checkpoint" }),
      mission({ id: "m3", title: "Done", status: "completed" }),
    ],
    2,
  );
  assert.equal(recs.length, 2);
});
