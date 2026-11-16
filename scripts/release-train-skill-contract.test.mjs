// The release-train skill must stay in step with the runner it describes and
// keep its authority boundary: the skill may verify, never tag or merge.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PHASES } from "./release-train.mjs";

const skill = readFileSync(new URL("../.agents/skills/release-train/SKILL.md", import.meta.url), "utf8");

test("the skill has a name and a trigger description within the skill limits", () => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? "";
  assert.match(frontmatter, /^name: release-train$/m);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  assert.ok(description.length > 0 && description.length <= 500, `description is ${description.length} characters`);
});

test("the skill lists every phase of the runner, in order", () => {
  const listed = [...skill.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(listed, PHASES.map((phase) => phase.id));
});

test("the skill points at the runbook and keeps tags and merges with the maintainer", () => {
  assert.ok(skill.includes("docs/workflows/release-train.md"));
  assert.match(skill, /never runs them, and\s+neither do you/);
  assert.match(skill, /Never capture against a real\s+`~\/\.coven`/);
});
