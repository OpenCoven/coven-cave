// @ts-nocheck
// #5448: the spawn-PATH cache is process-wide. server.mjs and Next's route
// handlers bundle separate copies of coven-bin, so a module-level cache let the
// server's startup warm-up fill one copy while the routes still ran the login
// shell on their first call. Checked without spawning a shell: a PATH placed in
// the shared slot is what a second, separately imported copy returns.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { delimiter } from "node:path";

const SLOT = Symbol.for("opencoven.cave.spawnPathState");
// A single directory, so the check holds on any platform's PATH delimiter.
const SENTINEL = process.platform === "win32" ? "C:\\shared-sentinel\\bin" : "/opt/shared-sentinel/bin";
const first = await import(`./coven-bin.ts?copy=first-${Date.now()}`);
const second = await import(`./coven-bin.ts?copy=second-${Date.now()}`);
const state = globalThis[SLOT];
assert.ok(state, "coven-bin publishes its PATH state on a process-wide slot");

const saved = { ...state };
try {
  state.cachedPath = SENTINEL;
  const path = second.covenSpawnEnv().PATH ?? second.covenSpawnEnv().Path ?? "";
  // spawnEnv puts Cave's managed toolchain dirs first; the sentinel can only
  // appear at all if this copy read the shared slot rather than discovering.
  assert.ok(
    path.split(delimiter).includes(SENTINEL),
    `a second module copy reads the cache the first published (got ${path.slice(0, 120)})`,
  );
  const fromFirst = await first.covenSpawnEnvAsync();
  assert.ok((fromFirst.PATH ?? fromFirst.Path ?? "").split(delimiter).includes(SENTINEL), "the async API reads the same slot");
} finally {
  Object.assign(state, saved);
}

// The in-flight warm-up is process-wide for the same reason, and the custom
// server starts it right after listening, without awaiting it.
const spawnEnvSource = readFileSync(new URL("./harness-spawn-env.ts", import.meta.url), "utf8");
assert.match(spawnEnvSource, /Symbol\.for\("opencoven\.cave\.spawnPathWarmUp"\)/, "the warm-up slot is process-wide");
const server = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
assert.match(
  server,
  /server\.listen\(port, hostname, \(\) => \{[\s\S]*?console\.log\(`> Ready on[\s\S]*?void warmHarnessSpawnPath\(\);\s*\}\);/,
  "the server warms the spawn PATH once it is listening, without delaying startup",
);

console.log("spawn-path-shared-state.test.ts: ok");
