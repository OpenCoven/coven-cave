// @ts-nocheck
import assert from "node:assert/strict";
import { patchTomlAutomationFields, patchTomlStatus } from "./codex-automations.ts";

const original = `version = 1
id = "ios-application-priority-audit"
kind = "cron"
name = "iOS Application Priority Audit"
prompt = '''Old prompt
with multiple lines'''
status = "PAUSED"
rrule = "RRULE:FREQ=WEEKLY;BYHOUR=2;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA"
model = "gpt-5.4"
reasoning_effort = "medium"
execution_environment = "worktree"
cwds = ["/tmp/old"]
tags = ["ios", "audit"]
skill_path = "/Users/buns/.coven/skills/coven-task-manager"
`;

const patched = patchTomlAutomationFields(original, {
  name: 'Priority "Audit"',
  prompt: "Daily task: iOS Application Priority Audit\n\nLook for drift.",
  status: "ACTIVE",
  rrule: "RRULE:FREQ=WEEKLY;BYHOUR=6;BYMINUTE=30;BYDAY=MO,WE,FR",
  model: "gpt-5.5",
  reasoning_effort: "high",
  execution_environment: "worktree",
  cwds: ["/Users/buns/Documents/GitHub/OpenCoven/coven-cave"],
  tags: ["ios", "priority", "audit"],
});

assert.match(patched, /^name = "Priority \\"Audit\\""/m);
assert.match(patched, /^status = "ACTIVE"/m);
assert.match(patched, /^rrule = "RRULE:FREQ=WEEKLY;BYHOUR=6;BYMINUTE=30;BYDAY=MO,WE,FR"/m);
assert.match(patched, /^model = "gpt-5.5"/m);
assert.match(patched, /^reasoning_effort = "high"/m);
assert.match(patched, /^execution_environment = "worktree"/m);
assert.match(patched, /^cwds = \["\/Users\/buns\/Documents\/GitHub\/OpenCoven\/coven-cave"\]/m);
assert.match(patched, /^tags = \["ios", "priority", "audit"\]/m);
assert.ok(patched.includes("prompt = '''Daily task: iOS Application Priority Audit\n\nLook for drift.\n'''"));
assert.ok(!patched.includes("Old prompt"));
assert.ok(patched.includes('skill_path = "/Users/buns/.coven/skills/coven-task-manager"'));

const oddlyFormatted = `version = 1
  status = 'PAUSED' # keep old comment
  prompt = '''Old prompt
still old
'''
`;

const patchedOdd = patchTomlAutomationFields(oddlyFormatted, {
  status: "ACTIVE",
  prompt: "New prompt",
});

assert.match(patchedOdd, /^  status = "ACTIVE"$/m);
assert.ok(patchedOdd.includes("  prompt = '''New prompt\n'''"));
assert.ok(!patchedOdd.includes("still old"));
assert.equal((patchedOdd.match(/^\s*status\s*=/gm) ?? []).length, 1);
assert.equal((patchedOdd.match(/^\s*prompt\s*=/gm) ?? []).length, 1);

const bareStatus = patchTomlStatus("status = PAUSED # old\n", "ACTIVE");
assert.match(bareStatus, /^status = "ACTIVE"$/m);
assert.equal((bareStatus.match(/^\s*status\s*=/gm) ?? []).length, 1);
