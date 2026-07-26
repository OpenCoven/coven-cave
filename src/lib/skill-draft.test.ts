import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSkillDraftPrompt, parseSkillDraftOutput } from "@/lib/skill-draft";

describe("skill draft prompt", () => {
  it("carries the goal, the trigger doctrine, and the exact output contract", () => {
    const prompt = buildSkillDraftPrompt("  Turn merged PRs into release notes.  ");
    assert.match(prompt, /Turn merged PRs into release notes\./, "carries the trimmed goal");
    assert.match(prompt, /description.*is the TRIGGER/i, "teaches the description-as-trigger doctrine");
    assert.match(prompt, /NAME: <skill name/, "documents the contract");
    assert.match(prompt, /TAGS: <0-6/, "documents the tags line");
    assert.match(prompt, /no fences, no preamble/, "forbids fenced responses");
  });
});

describe("skill draft output contract", () => {
  it("parses well-formed output", () => {
    const out = parseSkillDraftOutput(
      "NAME: Release Notes Writer\nDESCRIPTION: Use when asked for release notes.\nTAGS: release, notes\n---\n## When to use\nAlways.",
    );
    assert.deepEqual(out, {
      name: "Release Notes Writer",
      description: "Use when asked for release notes.",
      tags: ["release", "notes"],
      instructions: "## When to use\nAlways.",
    });
  });

  it("tolerates a whole-response fence and empty tags", () => {
    const out = parseSkillDraftOutput("```\nNAME: N\nDESCRIPTION: D\nTAGS:\n---\nBody\n```");
    assert.equal(out?.name, "N");
    assert.deepEqual(out?.tags, []);
    assert.equal(out?.instructions, "Body");
  });

  it("never strips fences INSIDE the instructions (only a whole-response wrap)", () => {
    const body = "Intro\n```bash\nls\n```\nAfter";
    const out = parseSkillDraftOutput(`NAME: N\nDESCRIPTION: D\nTAGS: a\n---\n${body}`);
    assert.equal(out?.instructions, body);
  });

  it("caps name and description at the build limits", () => {
    const out = parseSkillDraftOutput(
      `NAME: ${"n".repeat(200)}\nDESCRIPTION: ${"d".repeat(900)}\nTAGS: a\n---\nBody`,
    );
    assert.equal(out?.name.length, 80);
    assert.equal(out?.description.length, 500);
  });

  it("rejects malformed output instead of guessing", () => {
    assert.equal(parseSkillDraftOutput("Sure! Here's a skill: ..."), null);
    assert.equal(parseSkillDraftOutput("NAME: X\nDESCRIPTION: D\nTAGS: a\n---\n"), null);
    assert.equal(parseSkillDraftOutput(""), null);
  });
});
