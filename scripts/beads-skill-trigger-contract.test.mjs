import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(".agents/skills/beads/SKILL.md", "utf8");
const launcher = readFileSync(".agents/skills/beads/agents/openai.yaml", "utf8");
const description = /^description: (.+)$/m.exec(skill)?.[1];

test("trigger retains durable Beads operations", () => {
  assert.ok(description, "Beads skill must declare a trigger description");
  assert.ok(description.length <= 500, "skill description must fit the 500-character metadata limit");

  for (const cue of [
    "find ready work",
    "claim or close tasks",
    "create shared follow-up work",
    "inspect dependencies or blockers",
    "recover cross-session context",
    "local planning and persistent tracking",
  ]) {
    assert.ok(description.includes(cue), `trigger is missing durable-work cue: ${cue}`);
  }
});

test("trigger excludes routine one-turn work in Beads repositories", () => {
  assert.match(description, /Do not load merely because a repository uses Beads/);
  assert.match(description, /routine one-turn coding, styling, explanation, or review work/);
  assert.match(skill, /## When Not to Load/);
  assert.match(skill, /Following that workflow does not by itself make Beads expertise part of the user's request/);
});

test("launcher prompt carries the same negative boundary", () => {
  assert.match(launcher, /only when the request needs durable shared tasks/);
  assert.match(launcher, /Do not use it merely because the repository has Beads/);
  assert.match(launcher, /routine one-turn coding or styling/);
});
