/**
 * store-read-benchmark — what one `~/.coven` store read costs (cave-i65lt).
 *
 * `pnpm bench:store-reads`
 *
 * Measures `loadConfig` / `loadState` / `loadProjects` against a throwaway home
 * in `tmpdir()`, never the developer's real `~/.coven`. Three shapes:
 *
 *  - each loader on its own, the unit cost;
 *  - all three under one `Promise.all`, which is the serialization probe —
 *    `withCaveHomeReconciliationLock` queues on a single key for the whole
 *    process, so if these serialize the total lands near the SUM of the three
 *    rather than near the MAX;
 *  - the read set one `computeSessionsList` performs (state + projects, then
 *    config three times: once via `callDaemon` -> `loadDaemonTarget`, once in
 *    `sweepAutoArchive`, once in `sweepMergedPrAutoArchive`). That is the
 *    number the four-second sessions poll actually pays.
 *
 * The stores are deliberately tiny. This measures lock and journal overhead,
 * not parse cost — a few dozen bytes of JSON parse in microseconds, so anything
 * above that is the reconciliation machinery.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Blank reads as "not set", matching `conversation-list-benchmark.mjs`. A
 * workflow writing `CAVE_BENCH_ITERATIONS: ${{ inputs.iterations }}` sets an
 * empty string on a scheduled run, and `??` only catches undefined — so
 * `Number("")` would silently select zero iterations and percentile() would
 * read off the end of an empty array.
 */
function iterations() {
  const raw = process.env.CAVE_BENCH_ITERATIONS?.trim();
  if (!raw) return 200;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`CAVE_BENCH_ITERATIONS must be a positive number, received ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
}

const N = iterations();
const emitJson = process.argv.includes("--json");

const home = await mkdtemp(path.join(tmpdir(), "cave-store-read-bench-"));
const caveHome = path.join(home, "cave");
await mkdir(caveHome, { recursive: true });
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = caveHome;
delete process.env.COVEN_SOCKET;

await writeFile(path.join(caveHome, "config.json"), JSON.stringify({ addons: { github: false } }));
await writeFile(path.join(caveHome, "state.json"), JSON.stringify({ sessionFamiliar: {} }));
await writeFile(path.join(caveHome, "projects.json"), JSON.stringify({ projects: [] }));

const { loadConfig, loadState } = await import(path.join(projectRoot, "src/lib/cave-config.ts"));
const { loadProjects } = await import(path.join(projectRoot, "src/lib/cave-projects.ts"));

function percentile(samples, fraction) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

async function measure(id, fn, count) {
  await fn(); // absorb the once-per-process migration
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  return {
    id,
    iterations: count,
    p50Ms: Number(percentile(samples, 0.5).toFixed(4)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(4)),
  };
}

const results = [];
results.push(await measure("store-read.config.p50-ms", () => loadConfig(), N));
results.push(await measure("store-read.state.p50-ms", () => loadState(), N));
results.push(await measure("store-read.projects.p50-ms", () => loadProjects(), N));
results.push(
  await measure(
    "store-read.parallel-three.p50-ms",
    async () => {
      await Promise.all([loadConfig(), loadState(), loadProjects()]);
    },
    N,
  ),
);
results.push(
  await measure(
    "store-read.sessions-list-shape.p50-ms",
    async () => {
      await Promise.all([loadState(), loadProjects()]);
      await loadConfig();
      await loadConfig();
      await loadConfig();
    },
    Math.max(1, Math.floor(N / 2)),
  ),
);

await rm(home, { recursive: true, force: true });

const byId = Object.fromEntries(results.map((entry) => [entry.id, entry]));
const unit = byId["store-read.config.p50-ms"].p50Ms
  + byId["store-read.state.p50-ms"].p50Ms
  + byId["store-read.projects.p50-ms"].p50Ms;
const parallel = byId["store-read.parallel-three.p50-ms"].p50Ms;
/**
 * parallel / (sum of the three measured on their own).
 *
 * Three reads that genuinely overlap cost about the slowest of them, so this
 * lands well below 1 — around 0.4 for three comparable reads. At or above 1
 * they serialized. ABOVE 1 is not a measurement error: queueing three
 * contenders on one lock costs more than paying them one at a time, so a
 * loaded machine amplifies rather than merely adding.
 *
 * This ratio, not the absolute milliseconds, is the number to watch. The
 * absolutes move by ~5x with machine load — the same reason
 * `conversation-list.cold-scan.share-of-full-parse-pct` is expressed as a
 * share in `performance-budgets.ts` rather than a duration.
 */
const serializationRatio = unit > 0 ? Number((parallel / unit).toFixed(3)) : null;

if (emitJson) {
  console.log(JSON.stringify({ iterations: N, results, serializationRatio }, null, 2));
} else {
  console.log(`\nCave store reads — ${N} iterations, throwaway home\n`);
  for (const entry of results) {
    console.log(`  ${entry.id.padEnd(40)} p50=${entry.p50Ms.toFixed(3)}ms  p95=${entry.p95Ms.toFixed(3)}ms`);
  }
  console.log(
    `\n  serialization ratio (parallel / sum-of-units): ${serializationRatio}` +
      `\n    < ~0.5  the three reads genuinely overlap` +
      `\n    ~1.0    they serialize on the shared lock queue` +
      `\n    > 1.0   they serialize AND contention amplifies the queue` +
      `\n  Prefer this ratio over the absolute milliseconds above: those move` +
      `\n  by several times with machine load, the ratio does not.\n`,
  );
}
