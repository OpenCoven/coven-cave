// Caveman rewrite prompt — pure prompt half of the prompt/parse pair. The
// parse half is skill-draft's parseSkillDraftOutput, reused verbatim: the
// caveman answer arrives in the same NAME/DESCRIPTION/TAGS/---/body contract.
import assert from "node:assert/strict";
import { buildSkillCavemanPrompt, SKILL_CAVEMAN_INSTRUCTIONS_MAX } from "./skill-caveman.ts";
import { parseSkillDraftOutput } from "./skill-draft.ts";

const prompt = buildSkillCavemanPrompt({
  name: "Release Notes Writer",
  description: "Use when turning merged PRs into notes.",
  instructions: "## Steps\n\nPlease carefully run `git log`.",
});

// Operator fields are embedded.
assert.match(prompt, /Release Notes Writer/);
assert.match(prompt, /Use when turning merged PRs into notes\./);
assert.match(prompt, /`git log`/);

// The register rules the model must follow.
assert.match(prompt, /caveman/i, "names the register");
assert.match(prompt, /code blocks?[\s\S]*?VERBATIM/i, "code stays untouched");
assert.match(prompt, /trigger/i, "description keeps its trigger function");

// The output contract matches parseSkillDraftOutput exactly.
assert.match(prompt, /NAME: /);
assert.match(prompt, /DESCRIPTION: /);
assert.match(prompt, /TAGS: none/);
assert.match(prompt, /\n---\n/);

// Empty optional fields get placeholders (never empty header lines).
const sparse = buildSkillCavemanPrompt({ name: "", description: "  ", instructions: "Do X." });
assert.match(sparse, /NAME: <unnamed>/);
assert.match(sparse, /DESCRIPTION: <none>/);

// A well-formed caveman answer round-trips through the shared parser.
const parsed = parseSkillDraftOutput(
  "NAME: Release Notes\nDESCRIPTION: Merged PRs → notes. Use on release.\nTAGS: none\n---\n## Steps\nRun `git log`. Group. Link PRs.",
);
assert.ok(parsed);
assert.equal(parsed.name, "Release Notes");
assert.equal(parsed.instructions.startsWith("## Steps"), true);

// The pinned `TAGS: none` line parses to a literal ["none"] — consumers MUST
// drop the tags field (the caveman route never returns it; tags are not rewritten).
assert.deepEqual(parsed.tags, ["none"]);

// Input budget exists and is sane (form instructions cap is 64 KiB).
assert.ok(SKILL_CAVEMAN_INSTRUCTIONS_MAX >= 16_000 && SKILL_CAVEMAN_INSTRUCTIONS_MAX <= 65_536);

console.log("skill-caveman.test.ts OK");
