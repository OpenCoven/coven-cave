import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(".agents/skills/beads/SKILL.md", "utf8");
const launcher = readFileSync(".agents/skills/beads/agents/openai.yaml", "utf8");
const description = /^description: (.+)$/m.exec(skill)?.[1];

test("legacy skill redirects active tracking without removing historical references", () => {
  assert.ok(description && description.length <= 500);
  assert.match(description, /Legacy reference only/);
  assert.match(description, /Do not create, claim, close, sync/);
  assert.match(description, /GitHub Issues and the Cave Project/);
  assert.match(skill, /Preserve old IDs, records, owners, statuses, dependencies/);
  assert.match(skill, /passive export/);
  assert.match(skill, /Do not run `bd` or restore Beads context hooks/);
  assert.match(skill, /Do not[\s\S]*bulk-import the archive/);
});

test("launcher no longer triggers a durable Beads workflow", () => {
  assert.match(launcher, /only to interpret historical references/);
  assert.match(launcher, /Do not run bd or restore Beads tracking/);
  assert.match(launcher, /GitHub Issues and the Cave Project for active work/);
  assert.doesNotMatch(launcher, /durable shared tasks|context recovery|task-tracker operations/);
});
