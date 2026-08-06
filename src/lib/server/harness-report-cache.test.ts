import assert from "node:assert/strict";

import {
  HARNESS_REPORT_CACHE_TTL_MS,
  clearHarnessReportCache,
  harnessReportsWithCache,
  readHarnessReports,
  setHarnessReportCacheClock,
  writeHarnessReports,
} from "./harness-report-cache.ts";

let clock = 0;
setHarnessReportCacheClock(() => clock);

// A cold read has nothing to offer.
clearHarnessReportCache();
assert.equal(readHarnessReports(), null, "an empty cache reports a miss, not an empty list");

// `/api/harnesses` writes through on every response; `/api/scry` reads.
writeHarnessReports([{ id: "codex" }, { id: "claude" }]);
assert.deepEqual(readHarnessReports(), [{ id: "codex" }, { id: "claude" }]);

clock += HARNESS_REPORT_CACHE_TTL_MS + 1;
assert.equal(
  readHarnessReports(),
  null,
  "a stale entry is a miss — a scry must never pick a harness from a forgotten probe",
);

// The whole point: the ~3.4s probe runs once, not once per scry.
clearHarnessReportCache();
let probes = 0;
const probe = async () => {
  probes += 1;
  return [{ id: "codex" }];
};

const cold = await harnessReportsWithCache(probe);
assert.equal(cold.cached, false);
assert.equal(probes, 1);

const warm = await harnessReportsWithCache(probe);
assert.equal(warm.cached, true, "the second scry inside the TTL pays nothing");
assert.equal(probes, 1);
assert.deepEqual(warm.reports, [{ id: "codex" }]);

// Two scries fired together share one probe rather than spawning two sets of
// `which` / `--version` children against the same runtimes.
clearHarnessReportCache();
probes = 0;
const gate: { release: () => void } = { release: () => {} };
const slowProbe = async () => {
  probes += 1;
  await new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  return [{ id: "claude" }];
};
const a = harnessReportsWithCache(slowProbe);
const b = harnessReportsWithCache(slowProbe);
await Promise.resolve();
gate.release();
const [ra, rb] = await Promise.all([a, b]);
assert.equal(probes, 1, "concurrent callers share one in-flight probe");
assert.deepEqual(ra.reports, [{ id: "claude" }]);
assert.deepEqual(rb.reports, [{ id: "claude" }]);

// A probe that throws must not wedge every later caller on a dead promise.
clearHarnessReportCache();
let attempts = 0;
const flaky = async () => {
  attempts += 1;
  if (attempts === 1) throw new Error("probe failed");
  return [{ id: "codex" }];
};
await assert.rejects(() => harnessReportsWithCache(flaky));
const recovered = await harnessReportsWithCache(flaky);
assert.deepEqual(recovered.reports, [{ id: "codex" }], "a failed probe is retried, not cached");

clearHarnessReportCache();
setHarnessReportCacheClock(() => Date.now());
console.log("harness report cache tests passed");
