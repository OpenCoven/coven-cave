// @ts-nocheck
// #5448: the spawn-PATH cache is process-wide. server.mjs and Next's route
// handlers bundle separate copies of coven-bin, so a module-level cache let the
// server's startup warm-up fill one copy while the routes still ran the login
// shell on their first call. Checked without spawning a shell: a PATH placed in
// the shared slot is what a second, separately imported copy returns.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SLOT = Symbol.for("opencoven.cave.spawnPathState");
const first = await import(`./coven-bin.ts?copy=first-${Date.now()}`);
const second = await import(`./coven-bin.ts?copy=second-${Date.now()}`);
const state = globalThis[SLOT];
assert.ok(state, "coven-bin publishes its PATH state on a process-wide slot");

const saved = { ...state };
try {
  state.cachedPath = "/opt/shared-sentinel/bin";
  const path = second.covenSpawnEnv().PATH ?? second.covenSpawnEnv().Path ?? "";
  // spawnEnv puts Cave's managed toolchain dirs first; the sentinel can only
  // appear at all if this copy read the shared slot rather than discovering.
  assert.ok(
    path.split(":").includes("/opt/shared-sentinel/bin"),
    `a second module copy reads the cache the first published (got ${path.slice(0, 120)})`,
  );
  const fromFirst = await first.covenSpawnEnvAsync();
  assert.ok((fromFirst.PATH ?? fromFirst.Path ?? "").split(":").includes("/opt/shared-sentinel/bin"), "the async API reads the same slot");
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
