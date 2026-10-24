import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createResearchLegacyImporter } from "./research-automation-import.ts";

const source = `version = "1"
id = "legacy-1"
kind = "cron"
name = "Existing research"
status = "ACTIVE"
rrule = "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0"
model = "test-model"
cwds = ["/fixture/project"]
tags = ["research-mission", "research-mission:mission-1", "retain"]
familiars = ["sage"]
prompt = """Keep the exact prompt.\nSecond line."""
`;

test("explicit preview/apply freezes metadata, keeps original ID and bytes, and retries the same intent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "research-import-"));
  try {
    const file = path.join(home, ".codex/automations/legacy-1/automation.toml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    const calls: unknown[] = [];
    const importer = createResearchLegacyImporter({ home, planRoot: path.join(home, "plans"), create: async (input, context) => {
      calls.push({ input, context });
      return { id: context!.automationId, status: "PAUSED", rrule: input.rrule, revision: 2 };
    } });
    const plan = await importer.preview("legacy-1", "mission-1", "America/Chicago");
    assert.equal(calls.length, 0);
    assert.equal(plan.sourceStatus, "ACTIVE");
    assert.equal(plan.targetStatus, "PAUSED");
    assert.equal(plan.input.model, "test-model");
    assert.deepEqual(plan.input.cwds, ["/fixture/project"]);
    assert.deepEqual(plan.input.familiars, ["sage"]);
    assert.deepEqual(plan.input.tags, ["research-mission", "research-mission:mission-1", "retain"]);
    assert.equal(plan.input.prompt, "Keep the exact prompt.\nSecond line.");
    assert.equal(plan.input.timezone, "America/Chicago");
    assert.equal((await importer.apply(plan.planId)).id, "legacy-1");
    await importer.apply(plan.planId);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(await readFile(file, "utf8"), source);
    await writeFile(file, source.replace("test-model", "changed"));
    await assert.rejects(importer.apply(plan.planId), /source-changed/);
    assert.equal(calls.length, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("strict import refuses unsupported fields, ambiguous mappings, schedules and source links before dispatch", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "research-import-refusal-"));
  try {
    const file = path.join(home, ".codex/automations/legacy-1/automation.toml");
    await mkdir(path.dirname(file), { recursive: true });
    const importer = createResearchLegacyImporter({ home, planRoot: path.join(home, "plans"), create: async () => { assert.fail("must not dispatch"); } });
    for (const invalid of [
      source + 'unknown_metadata = "retain me"\n',
      source + 'reasoning_effort = "high"\n',
      source.replace('cwds = ["/fixture/project"]', 'cwds = ["/one", "/two"]'),
      source.replace('research-mission:mission-1', 'research-mission:other'),
      source.replace('FREQ=WEEKLY', 'FREQ=MONTHLY'),
      source.replace('BYMINUTE=0', 'BYMINUTE=30'),
      source.replace('BYHOUR=9', 'BYHOUR=9;BYHOUR=10'),
      source.replace('BYHOUR=9', 'BYHOUR=9;COUNT=3'),
      source.replace('id = "legacy-1"', 'id = "different"'),
    ]) {
      await writeFile(file, invalid);
      await assert.rejects(importer.preview("legacy-1", "mission-1", "UTC"), /refused/);
    }
    await assert.rejects(importer.preview("../escape", "mission-1", "UTC"), /refused/);
    await writeFile(path.join(home, "outside.toml"), source);
    await rm(file);
    await symlink(path.join(home, "outside.toml"), file);
    await assert.rejects(importer.preview("legacy-1", "mission-1", "UTC"), /refused/);
  } finally { await rm(home, { recursive: true, force: true }); }
});


test("review plans accommodate escaped prompts larger than their source", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "research-import-plan-size-"));
  try {
    const file = path.join(home, ".codex/automations/legacy-1/automation.toml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source.replace("Keep the exact prompt.", "\t".repeat(70_000)));
    const importer = createResearchLegacyImporter({ home, planRoot: path.join(home, "plans"), create: async (input, context) => ({ id: context!.automationId, status: "PAUSED", rrule: input.rrule, revision: 2 }) });
    const plan = await importer.preview("legacy-1", "mission-1", "UTC");
    assert.equal((await importer.apply(plan.planId)).id, "legacy-1");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("selected FIFO is refused without blocking the request", { skip: process.platform === "win32" }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "research-import-fifo-"));
  try {
    const file = path.join(home, ".codex/automations/legacy-1/automation.toml");
    await mkdir(path.dirname(file), { recursive: true });
    execFileSync("mkfifo", [file]);
    const script = `import { createResearchLegacyImporter } from ${JSON.stringify(new URL("./research-automation-import.ts", import.meta.url).href)};
await createResearchLegacyImporter({home:${JSON.stringify(home)},planRoot:${JSON.stringify(path.join(home,"plans"))}}).preview("legacy-1","mission-1","UTC").then(()=>process.exit(2), error=>{if(!error.message.includes("source-size-or-type"))throw error;});`;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { timeout: 5000, encoding: "utf8" });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
  } finally { await rm(home, { recursive: true, force: true }); }
});
