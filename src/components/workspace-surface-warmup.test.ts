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

// The canonical vault had its own readiness-gated warmup beside the ordinary
// surface coordinator, because it could only be read on Cave's own host. The
// vault lives in the dedicated memory application now, so BOTH halves of that
// arrangement must be gone — the gated warmup, and any vault transport leaking
// into the unconditional coordinator.
assert.doesNotMatch(
  workspace,
  /useCanonicalMemoryWarmup|localDaemonReady/,
  "the vault's readiness-gated warmup and its local-daemon gate are retired",
);

assert.doesNotMatch(
  surfaceWarmup,
  /canonical-memory|\/api\/coven-memory/,
  "the unconditional surface coordinator never owns canonical-memory transport",
);
