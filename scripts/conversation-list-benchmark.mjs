import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_PATH = path.join(projectRoot, "fixtures", "phase-6", "performance-fixtures.json");

/**
 * Fixture scale lives in `fixtures/phase-6/performance-fixtures.json` so the
 * budget a run is judged against and the workload that produced it move
 * together. An explicit env var still wins, because a bisect needs to sweep one
 * dimension without editing a committed fixture — but a swept run says so in
 * the profile it reports, so it cannot be graded as the profile it departed
 * from. See `reportedProfile` below.
 *
 * Blank reads as "not set", the same way `dimension()` below treats a blank
 * numeric override — a workflow writing `CAVE_BENCH_PROFILE: ${{ inputs.profile }}`
 * (the exact shape the iterations input already has) sets an empty string on a
 * scheduled run, and `??` only catches undefined, so the run died on
 * `unknown benchmark profile ""` instead of falling back.
 */
const profileName = process.env.CAVE_BENCH_PROFILE?.trim() || "default";
const fixtures = JSON.parse(await readFile(FIXTURES_PATH, "utf8"));
const profile = fixtures.profiles?.[profileName];
if (!profile) {
  throw new Error(
    `unknown benchmark profile "${profileName}"; known: ${Object.keys(fixtures.profiles ?? {}).join(", ")}`,
  );
}

/**
 * A committed profile gets the same scrutiny as an env override.
 *
 * `dimension()` below rejects a malformed override but used to trust its
 * fallback absolutely, and the two malformed shapes are not equally loud: a
 * profile missing `iterations` crashes in percentile() and one missing
 * `fileCount` breaches the cache-hit floor, but a profile missing
 * `transcriptBytes` writes `"x".repeat(undefined)` — empty transcripts — and
 * exits 0 with every budget green. A budget is a claim about a workload, so a
 * profile that does not describe one must not be runnable at all.
 */
for (const key of ["fileCount", "transcriptBytes", "iterations"]) {
  if (!Number.isFinite(profile[key]) || profile[key] <= 0) {
    throw new Error(
      `benchmark profile "${profileName}" must define a positive ${key}, received ${JSON.stringify(profile[key])}`,
    );
  }
}

/**
 * A blank env var means "not overridden", not zero.
 *
 * A workflow that writes `CAVE_BENCH_ITERATIONS: ${{ inputs.iterations }}` sets
 * the variable to an empty string on a scheduled run, and `??` only catches
 * undefined — so `Number("")` would silently select 0 iterations, which
 * percentile() then reads off the end of an empty array.
 *
 * A value that differs from the profile's own is recorded, because the run is
 * then no longer that profile's workload and must not be reported as if it
 * were. A value equal to it changes nothing and is not an override.
 */
const overriddenDimensions = [];
function dimension(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, received "${raw}"`);
  }
  if (value !== fallback) overriddenDimensions.push(name);
  return value;
}

const fileCount = dimension("CAVE_BENCH_CONVERSATIONS", profile.fileCount);
const transcriptBytes = dimension("CAVE_BENCH_TRANSCRIPT_BYTES", profile.transcriptBytes);
const iterations = dimension("CAVE_BENCH_ITERATIONS", profile.iterations);

/**
 * What this run is entitled to claim it measured.
 *
 * The report grades enforced budgets by comparing this string against the
 * profile the budget's `source` names, so stamping the profile name alone let a
 * swept dimension inherit the profile's authority: with
 * `CAVE_BENCH_PROFILE=phase-6-list-10k CAVE_BENCH_CONVERSATIONS=25`, a
 * twenty-five-conversation run reported `profile: "phase-6-list-10k"` and
 * certified "10k conversation list, cold metadata scan p95 ≤ 3000 ms" as a pass
 * — the exact smoke-run-certifies-10k defect the profile check was added to
 * close, reached through the override door instead of the profile door. The
 * suffix cannot equal any key in the fixture file, so the report's existing
 * mismatch path records every enforced budget `unmeasured` and fails the run.
 */
const reportedProfile = overriddenDimensions.length === 0
  ? profileName
  : `${profileName} (overridden: ${overriddenDimensions.join(", ")})`;
const benchHome = await mkdtemp(path.join(tmpdir(), "cave-conversation-list-bench-"));

/**
 * Redirect the fixture with `COVEN_CAVE_HOME`, not `HOME`.
 *
 * `caveHome()` falls back to `os.homedir()`, which reads `$HOME` only on POSIX —
 * on Windows it reads `USERPROFILE` and ignores `$HOME` entirely. Pinning `HOME`
 * therefore isolated the fixture on Linux CI while writing `fileCount`
 * conversations into the developer's real `~/.coven/cave/conversations` on
 * Windows, where the temp-dir cleanup below could never reclaim them. At the
 * phase-6 scale that is 10,000 stray files. The documented pins are hermetic on
 * every platform, and Playwright already isolates itself the same way.
 */
const pinnedEnv = { COVEN_HOME: path.join(benchHome, ".coven"), COVEN_CAVE_HOME: path.join(benchHome, ".coven", "cave") };
const previousEnv = Object.fromEntries(
  Object.keys(pinnedEnv).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, pinnedEnv);

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percent))];
}

function summarize(label, durations, bytesRead) {
  return {
    label,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    bytesReadPerScan: bytesRead,
  };
}

try {
  const {
    clearConversationListMetadataCache,
    CONV_DIR,
    getConversationListMetrics,
    listConversations,
  } = await import("../src/lib/cave-conversations.ts");
  if (!path.resolve(CONV_DIR).startsWith(path.resolve(benchHome))) {
    throw new Error(
      `benchmark refused to run: CONV_DIR (${CONV_DIR}) escaped the fixture home (${benchHome})`,
    );
  }
  await mkdir(CONV_DIR, { recursive: true });
  const payload = "x".repeat(transcriptBytes);
  for (let index = 0; index < fileCount; index += 1) {
    const sessionId = `benchmark-${String(index).padStart(5, "0")}`;
    await writeFile(
      path.join(CONV_DIR, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        familiarId: "charm",
        harness: "codex",
        title: `Benchmark ${index}`,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
        turns: [{ id: "turn", role: "assistant", text: payload, createdAt: "2026-07-17T00:00:00.000Z" }],
      }),
      "utf8",
    );
  }

  const legacyDurations = [];
  let legacyBytes = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    let bytes = 0;
    for (const name of await readdir(CONV_DIR)) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(path.join(CONV_DIR, name), "utf8");
      bytes += Buffer.byteLength(raw);
      JSON.parse(raw);
    }
    legacyDurations.push(performance.now() - startedAt);
    legacyBytes = bytes;
  }

  // Cave's own cold scan, cleared before every iteration. The legacy loop above
  // is a control — it measures readdir+JSON.parse, not shipping code — so
  // budgeting it would police the benchmark rather than the product.
  const coldDurations = [];
  let coldMetrics = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    clearConversationListMetadataCache();
    const startedAt = performance.now();
    await listConversations();
    coldDurations.push(performance.now() - startedAt);
    coldMetrics = getConversationListMetrics();
  }

  const cachedDurations = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    await listConversations();
    cachedDurations.push(performance.now() - startedAt);
  }
  const cachedMetrics = getConversationListMetrics();

  console.log(
    JSON.stringify(
      {
        fixture: { profile: reportedProfile, fileCount, transcriptBytes, iterations },
        before: summarize("full transcript parse", legacyDurations, legacyBytes),
        cold: summarize("cold metadata scan", coldDurations, coldMetrics.bytesRead),
        after: summarize("warm metadata cache", cachedDurations, cachedMetrics.bytesRead),
        cacheHitRate: cachedMetrics.cacheHitRate,
      },
      null,
      2,
    ),
  );
} finally {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(benchHome, { recursive: true, force: true });
}
