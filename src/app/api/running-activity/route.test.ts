// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildRunningActivityPayload } from "@/lib/running-activity";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const lib = await readFile(new URL("../../../lib/running-activity.ts", import.meta.url), "utf8");

// ── Composition: every source is aggregated behind the one endpoint ──────────
test("the route aggregates all five sources through the shared lib", () => {
  for (const [name, load] of [
    ["sessions", /computeSessionsList/],
    ["board", /loadBoard\(\)/],
    ["automations", /listAutomationRuns\(\)/],
    ["flows", /listFlowRuns\(\)/],
    ["workflows", /listWorkflowRuns\(\)/],
  ]) {
    assert.match(route, load, `the route loads ${name}`);
  }
  assert.match(route, /buildRunningActivityPayload\(/);
  assert.match(route, /NextResponse\.json\(payload\)/);
});

// ── Partial-source status: a failing source is isolated, not fatal ──────────
test("each source is isolated so one failure cannot sink the response", () => {
  assert.match(
    route,
    /try \{\s*return \{ ok: true, items: map\(await load\(\)\) \};\s*\} catch \(err\) \{/,
    "loadSource returns ok items or a caught error",
  );
  assert.match(route, /return \{ ok: false, error: err instanceof Error \? err\.message : "unknown" \};/);
  // Every source (sessions included) goes through the isolating loader.
  assert.match(route, /loadSource\(/);
  assert.match(route, /Promise\.all\(\[\s*loadSource\(\(\) => loadBoard\(\)/);
});

test("sessions use the read-only, subprocess-free projection", () => {
  assert.match(route, /sweepArchives: false/);
  assert.match(route, /enrichGit: false/);
});

test("automations use the daemon run ledger after local run-history retirement", () => {
  assert.doesNotMatch(
    route,
    /import \{ listRuns as listAutomationRuns \} from "@\/lib\/automation-runs"/,
  );
  assert.match(route, /listRoutines\(\)/);
  assert.match(route, /const AUTOMATION_RUN_HISTORY_LIMIT = 20/);
  assert.match(route, /const AUTOMATION_RUN_FETCH_CONCURRENCY = 4/);
  assert.match(route, /listRoutineRuns\(routine\.id, AUTOMATION_RUN_HISTORY_LIMIT\)/);
  assert.match(route, /routines\.slice\(index, index \+ AUTOMATION_RUN_FETCH_CONCURRENCY\)/);
  assert.match(route, /\.filter\(\(run\) => run\.status === "running"\)/);
  assert.match(route, /automationName: routine\.name/);
});

// ── Behavioural contract the route depends on ────────────────────────────────
test("a failing source is marked unavailable while the rest of the payload survives", () => {
  const payload = buildRunningActivityPayload(
    {
      sessions: {
        ok: true,
        items: [
          { id: "session:s1", kind: "session", title: "Live chat", status: "running", startedAt: "2026-08-23T09:00:00.000Z", familiarId: null, targetId: "s1" },
        ],
      },
      board: { ok: true, items: [] },
      automations: { ok: true, items: [] },
      flows: { ok: false, error: "corrupt flow-runs.json" },
      workflows: { ok: false, error: "permission denied" },
    },
    "2026-08-23T12:00:00.000Z",
  );
  assert.equal(payload.ok, true, "the top-level response is still ok");
  assert.deepEqual(payload.unavailable, ["flows", "workflows"]);
  assert.equal(payload.sources.flows.ok, false);
  assert.equal(payload.sources.workflows.error, "permission denied");
  assert.equal(payload.total, 1);
  assert.equal(payload.items[0].targetId, "s1");
});

// The payload carries the partial-source vocabulary the popover renders.
assert.match(
  lib,
  /unavailable: RunningActivitySourceId\[\];/,
  "the payload exposes the unavailable source ids",
);
assert.match(
  lib,
  /state\[id\] = \{ ok: false, count: 0, error: source\.error \};/,
  "an unavailable source records its error rather than throwing",
);

console.log("running-activity route.test.ts: ok");
