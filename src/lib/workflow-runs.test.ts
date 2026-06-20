import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "cave-workflow-runs-"));
const runsPath = path.join(dir, "workflow-runs.json");
process.env.COVEN_WORKFLOW_RUNS_PATH = runsPath;

// Import AFTER the env override so the module resolves the test path.
const { clearRuns, listRuns, recordRun, RUNS_HISTORY_CAP } = await import("./workflow-runs.ts");

try {
  // --- record assigns an id and newest-first ordering ---
  const first = await recordRun({
    workflowId: "demo",
    kind: "dry-run",
    status: "plan",
    startedAt: "2026-06-11T01:00:00.000Z",
    steps: [{ id: "a", kind: "agent", status: "ready" }],
    source: "cave",
  });
  assert.ok(first.id.length > 0, "record assigns an id");

  await recordRun({
    workflowId: "other",
    kind: "execution",
    status: "succeeded",
    startedAt: "2026-06-11T02:00:00.000Z",
    steps: [],
    source: "daemon",
  });

  const all = await listRuns();
  assert.equal(all.length, 2);
  assert.equal(all[0].workflowId, "other", "newest run is first");

  // --- filter by workflowId ---
  const demoOnly = await listRuns("demo");
  assert.equal(demoOnly.length, 1);
  assert.equal(demoOnly[0].id, first.id);

  // --- history cap ---
  for (let i = 0; i < RUNS_HISTORY_CAP + 10; i += 1) {
    await recordRun({
      workflowId: "bulk",
      kind: "dry-run",
      status: "plan",
      startedAt: `2026-06-11T03:00:${String(i % 60).padStart(2, "0")}.000Z`,
      steps: [],
      source: "cave",
    });
  }
  const capped = await listRuns();
  assert.ok(capped.length <= RUNS_HISTORY_CAP, `history is capped (got ${capped.length})`);

  // --- corrupt store degrades to empty, then recovers on next write ---
  await writeFile(runsPath, "{not json", "utf8");
  assert.deepEqual(await listRuns(), [], "corrupt store reads as empty");
  const recovered = await recordRun({
    workflowId: "demo",
    kind: "dry-run",
    status: "plan",
    startedAt: "2026-06-11T04:00:00.000Z",
    steps: [],
    source: "cave",
  });
  assert.equal((await listRuns())[0].id, recovered.id, "store recovers after corruption");

  // --- clearRuns drops one workflow's runs, then all ---
  await recordRun({ workflowId: "keep", kind: "dry-run", status: "plan", startedAt: "2026-06-11T05:00:00.000Z", steps: [], source: "cave" });
  const demoCount = (await listRuns("demo")).length;
  const clearedDemo = await clearRuns("demo");
  assert.equal(clearedDemo, demoCount, "clearRuns returns how many it removed");
  assert.deepEqual(await listRuns("demo"), [], "scoped clear empties that workflow");
  assert.ok((await listRuns("keep")).length > 0, "scoped clear leaves other workflows");
  const total = (await listRuns()).length;
  assert.equal(await clearRuns(), total, "clearRuns() with no id removes everything");
  assert.deepEqual(await listRuns(), [], "unscoped clear empties the store");
} finally {
  delete process.env.COVEN_WORKFLOW_RUNS_PATH;
  await rm(dir, { recursive: true, force: true });
}

console.log("workflow-runs.test.ts: ok");
