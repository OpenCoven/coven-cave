// formatSkillDraft is the Build tab's Format button: it applies EXACTLY the
// canonicalization composeSkillMd performs at save/preview time, so pressing
// Format never changes the written artifact — only aligns the form with it.
import assert from "node:assert/strict";
import { composeSkillMd, formatSkillDraft } from "./skill-build-format.ts";

// Quote swap + whitespace collapse in frontmatter fields.
let out = formatSkillDraft({
  name: 'Release  "Notes"\nWriter',
  description: '  Say "hi"\r\nthen   stop. ',
  tags: ["release", "notes"],
  instructions: "## Steps\n\nDo the thing.\n",
});
assert.equal(out.name, "Release 'Notes' Writer");
assert.equal(out.description, "Say 'hi' then stop.");

// Tags: trim, drop invalid, dedupe, cap 12.
out = formatSkillDraft({
  name: "n",
  description: "d",
  tags: [" a ", "a", "bad!tag", "", "b.c-d 2"],
  instructions: "x",
});
assert.deepEqual(out.tags, ["a", "b.c-d 2"]);

// Instructions: CRLF → LF and outer trim only — interior structure untouched.
out = formatSkillDraft({
  name: "n",
  description: "d",
  tags: [],
  instructions: "\r\n## When\r\n\r\n- use `\"quotes\"` here\r\n",
});
assert.equal(out.instructions, "## When\n\n- use `\"quotes\"` here");

// Idempotent.
const once = formatSkillDraft({ name: 'a "b"', description: "c  d", tags: ["t"], instructions: "e\r\nf" });
assert.deepEqual(formatSkillDraft(once), once);

// Same-artifact invariant: formatting never changes the composed file.
const raw = {
  name: ' The "Great" Skill ',
  description: 'Use when "X"\nhappens',
  tags: [" a ", "a", "!!", "b"],
  instructions: "\r\n## Steps\r\nDo it.\r\n",
};
assert.equal(composeSkillMd(formatSkillDraft(raw)), composeSkillMd(raw));

console.log("skill-build-format.test.ts OK");
