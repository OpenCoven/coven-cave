import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const skill = fs.readFileSync(".agents/skills/beads/SKILL.md", "utf8");
const openai = fs.readFileSync(".agents/skills/beads/agents/openai.yaml", "utf8");
const description = skill.match(/^description:\s*(.+)$/m)?.[1] ?? "";

test("Beads discovery metadata excludes routine repository work", () => {
  assert.match(description, /when Beads itself is part of the task/i);
  assert.match(description, /finding, claiming, closing, or creating tracked work/i);
  assert.match(description, /blockers or dependencies/i);
  assert.match(description, /Do not load for routine coding, styling, review, or explanation/i);
  assert.match(description, /merely because a repository uses bd/i);
});

test("Beads instructions explain the positive and negative boundaries", () => {
  assert.match(skill, /## When to Load/);
  assert.match(skill, /## When Not to Load/);
  assert.match(skill, /self-contained coding, styling, review, or\s+explanation request/i);
  assert.match(skill, /repository instructions already prescribe routine Beads bookkeeping/i);
  assert.match(skill, /only when the task needs\s+Beads-specific guidance or Beads is itself part of the requested outcome/i);
});

test("Beads launcher prompt preserves the negative boundary", () => {
  assert.match(openai, /only when durable project-task coordination is part of the task/i);
  assert.match(openai, /not for routine repository work merely because bd is installed/i);
});
