import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const fileCount = Number(process.env.CAVE_BENCH_CONVERSATIONS ?? 100);
const transcriptBytes = Number(process.env.CAVE_BENCH_TRANSCRIPT_BYTES ?? 256 * 1024);
const iterations = Number(process.env.CAVE_BENCH_ITERATIONS ?? 20);
const benchHome = await mkdtemp(path.join(tmpdir(), "cave-conversation-list-bench-"));
const previousHome = process.env.HOME;
process.env.HOME = benchHome;

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
  await mkdir(CONV_DIR, { recursive: true });
  const payload = "x".repeat(transcriptBytes);
  for (let index = 0; index < fileCount; index += 1) {
    const sessionId = `benchmark-${String(index).padStart(4, "0")}`;
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

  clearConversationListMetadataCache();
  await listConversations();
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
        fixture: { fileCount, transcriptBytes, iterations },
        before: summarize("full transcript parse", legacyDurations, legacyBytes),
        after: summarize("warm metadata cache", cachedDurations, cachedMetrics.bytesRead),
        cacheHitRate: cachedMetrics.cacheHitRate,
      },
      null,
      2,
    ),
  );
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(benchHome, { recursive: true, force: true });
}
