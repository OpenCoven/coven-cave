// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const surfaceWarmup = await readFile(
  new URL("../lib/use-surface-warmup.ts", import.meta.url),
  "utf8",
);

assert.match(
  workspace,
  /type: "deleted"; id: string \};[\s\S]{0,500}?publishSchedulesChanged\(\)/,
  "authoritative inbox SSE events invalidate Schedules' warmed landing cache",
);

assert.match(
  workspace,
  /useCanonicalMemoryWarmup\(localDaemonReady\);[\s\S]{0,80}useSurfaceWarmup\(\);/,
  "local canonical memory has a separate readiness-gated lifecycle from ordinary surface warmup",
);

assert.doesNotMatch(
  surfaceWarmup,
  /canonical-memory|\/api\/coven-memory/,
  "the unconditional surface coordinator never owns local canonical-memory transport",
);
