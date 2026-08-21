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
 * dimension without editing a committed fixture.
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
 * A blank env var means "not overridden", not zero.
 *
 * A workflow that writes `CAVE_BENCH_ITERATIONS: ${{ inputs.iterations }}` sets
 * the variable to an empty string on a scheduled run, and `??` only catches
 * undefined — so `Number("")` would silently select 0 iterations, which
 * percentile() then reads off the end of an empty array.
 */
function dimension(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, received "${raw}"`);
  }
  return value;
}

const fileCount = dimension("CAVE_BENCH_CONVERSATIONS", profile.fileCount);
const transcriptBytes = dimension("CAVE_BENCH_TRANSCRIPT_BYTES", profile.transcriptBytes);
const iterations = dimension("CAVE_BENCH_ITERATIONS", profile.iterations);
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
        fixture: { profile: profileName, fileCount, transcriptBytes, iterations },
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
