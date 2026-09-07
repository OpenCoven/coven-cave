import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const previousE2E = process.env.COVEN_CAVE_E2E;

async function loadConfig(e2e) {
  if (e2e === undefined) delete process.env.COVEN_CAVE_E2E;
  else process.env.COVEN_CAVE_E2E = e2e;

  try {
    const url = new URL(`../next.config.ts?cache-test=${randomUUID()}`, import.meta.url);
    return (await import(url.href)).default;
  } finally {
    if (previousE2E === undefined) delete process.env.COVEN_CAVE_E2E;
    else process.env.COVEN_CAVE_E2E = previousE2E;
  }
}

const localConfig = await loadConfig(undefined);
const e2eConfig = await loadConfig("1");
const playwrightConfig = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");

assert.equal(
  localConfig.experimental.turbopackFileSystemCacheForDev,
  false,
  "dev must keep Turbopack's persistent filesystem cache disabled so multi-gigabyte compaction cannot stall the PostCSS worker",
);
assert.equal(
  localConfig.experimental.turbopackMemoryEviction,
  false,
  "ordinary local dev explicitly disables eviction with its intentionally disabled filesystem cache",
);
assert.equal(
  e2eConfig.experimental.turbopackFileSystemCacheForDev,
  true,
  "daemon-less E2E persists its short-lived Turbopack graph so compiled data can be evicted",
);
assert.equal(
  e2eConfig.experimental.turbopackMemoryEviction,
  "full",
  "daemon-less E2E evicts every persisted snapshot instead of exhausting the runner",
);
assert.match(
  playwrightConfig,
  /TURBO_ENGINE_SNAPSHOT_IDLE_TIMEOUT_MILLIS:\s*"1000"/,
  "E2E snapshots after the same bounded idle window exercised by Next's eviction fixture",
);
assert.match(
  playwrightConfig,
  /TURBO_ENGINE_SNAPSHOT_MIN_ACTIVE_TIME_MILLIS:\s*"0"/,
  "cold E2E compiles may snapshot before their retained graph exhausts the runner",
);

console.log("turbopack-dev-cache.test.mjs: ok");
