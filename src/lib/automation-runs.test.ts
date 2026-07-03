import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "auto-runs-"));
  process.env.COVEN_AUTOMATION_RUNS_PATH = path.join(dir, "runs.json");
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test("recordRun assigns id + newest-first; listRuns filters by automation", async () => {
  const { recordRun, listRuns } = await import("./automation-runs.ts");
  const a = await recordRun({ automationId: "x", automationName: "X", startedAt: "2026-01-01T00:00:00Z", status: "running" });
  const b = await recordRun({ automationId: "y", automationName: "Y", startedAt: "2026-01-01T00:01:00Z", status: "running" });
  assert.ok(a.id && b.id && a.id !== b.id);
  const all = await listRuns();
  assert.equal(all[0].id, b.id, "newest first");
  const onlyX = await listRuns("x");
  assert.equal(onlyX.length, 1);
  assert.equal(onlyX[0].id, a.id);
});

test("updateRun patches by id; latestRun + hasRunningRun", async () => {
  const { recordRun, updateRun, latestRun, hasRunningRun } = await import("./automation-runs.ts");
  const r = await recordRun({ automationId: "z", automationName: "Z", startedAt: "2026-01-02T00:00:00Z", status: "running" });
  assert.ok(await hasRunningRun("z"));
  const updated = await updateRun(r.id, { status: "succeeded", finishedAt: "2026-01-02T00:00:05Z", exitCode: 0 });
  assert.equal(updated?.status, "succeeded");
  assert.ok(!(await hasRunningRun("z")));
  assert.equal((await latestRun("z"))?.status, "succeeded");

  // Deleting an automation purges its history — a re-created automation that
  // reuses the same slug must not inherit the old runs.
  const { purgeRuns, listRuns } = await import("./automation-runs.ts");
  await recordRun({ automationId: "gone", automationName: "Gone", startedAt: "2026-01-03T00:00:00Z", status: "succeeded" });
  assert.equal((await listRuns("gone")).length, 1);
  await purgeRuns("gone");
  assert.equal((await listRuns("gone")).length, 0, "purged automation has no runs");
  assert.ok(await latestRun("z"), "other automations' runs survive the purge");
});
