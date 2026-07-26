import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSkillTriggerCheckPrompt,
  buildSkillWalkthroughPrompt,
  parseTriggerCheckOutput,
  parseWalkthroughOutput,
} from "@/lib/skill-dryrun";

describe("trigger check", () => {
  it("prompts strictly from the frontmatter with the verdict contract", () => {
    const prompt = buildSkillTriggerCheckPrompt({
      name: "Release Notes Writer",
      description: "Use when asked for release notes.",
      scenario: "The user asks for last week's release notes.",
    });
    assert.match(prompt, /ONLY the/, "the check sees only the frontmatter");
    assert.match(prompt, /No benefit of the doubt/, "vague descriptions must miss");
    assert.match(prompt, /FIRES: <yes\|no>/, "documents the verdict contract");
    assert.match(prompt, /REASON: <one line/, "requires the deciding words");
  });

  it("parses both verdicts and tolerates a fence", () => {
    assert.deepEqual(parseTriggerCheckOutput("FIRES: yes\nREASON: 'release notes' matches."), {
      fires: true,
      reason: "'release notes' matches.",
    });
    assert.deepEqual(parseTriggerCheckOutput("```\nFIRES: no\nREASON: nothing covers billing.\n```"), {
      fires: false,
      reason: "nothing covers billing.",
    });
  });

  it("rejects malformed verdicts instead of guessing", () => {
    assert.equal(parseTriggerCheckOutput("FIRES: maybe\nREASON: hmm"), null);
    assert.equal(parseTriggerCheckOutput("It fires!"), null);
    assert.equal(parseTriggerCheckOutput("FIRES: yes\nREASON:"), null);
  });
});

describe("walkthrough check", () => {
  it("prompts narration-only with the notes contract", () => {
    const prompt = buildSkillWalkthroughPrompt({
      name: "N",
      description: "D",
      instructions: "## Steps\n1. Do it.",
      scenario: "S",
    });
    assert.match(prompt, /IN NARRATION ONLY/, "no tools, no pretend execution");
    assert.match(prompt, /FOLLOWED: <yes\|partial\|no>/, "documents the verdict contract");
    assert.match(prompt, /## Steps/, "carries the instructions body");
  });

  it("parses verdict + notes list, capped at six", () => {
    const out = parseWalkthroughOutput(
      `FOLLOWED: partial\nNOTES:\n- step 2 assumes a tool that isn't named\n- no verification step\n${"- extra\n".repeat(8)}`,
    );
    assert.equal(out?.followed, "partial");
    assert.equal(out?.notes.length, 6);
    assert.equal(out?.notes[0], "step 2 assumes a tool that isn't named");
  });

  it("rejects malformed output instead of guessing", () => {
    assert.equal(parseWalkthroughOutput("FOLLOWED: yes"), null);
    assert.equal(parseWalkthroughOutput("FOLLOWED: kinda\nNOTES:\n- x"), null);
    assert.equal(parseWalkthroughOutput(""), null);
  });
});
