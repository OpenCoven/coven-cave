import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// docs/runtime-startup-supervision.md is the page a person opens to learn how
// Cave supervises the daemon and its own startup workers. It fell behind the
// code once: the lifecycle projection, the mutation owner and the startup
// worker coordinator all shipped without a line there (#6334). These pins
// fail when a projected state, a registered startup worker or the signal
// observation budget is no longer named in the document.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");
const doc = read("docs/runtime-startup-supervision.md");

const lifecycleSource = read("src/lib/daemon-lifecycle.ts");
const statesBlock = lifecycleSource.match(/export const DAEMON_LIFECYCLE_STATES = \[([\s\S]*?)\] as const;/);
assert.ok(statesBlock, "DAEMON_LIFECYCLE_STATES must still be a literal tuple in src/lib/daemon-lifecycle.ts");
const states = [...statesBlock[1].matchAll(/"([a-z-]+)"/g)].map(([, state]) => state);
assert.ok(states.length >= 10, `expected the full state tuple, parsed ${states.length}`);

test("every projected daemon lifecycle state is named in the supervision document", () => {
  const missing = states.filter((state) => !doc.includes(`\`${state}\``));
  assert.deepEqual(missing, [], `docs/runtime-startup-supervision.md does not name: ${missing.join(", ")}`);
});

test("every startup worker instrumentation registers is named in the supervision document", () => {
  const instrumentation = read("src/instrumentation.ts");
  const workers = [...instrumentation.matchAll(/registerStartupWorker\("([a-z-]+)"/g)].map(([, name]) => name);
  assert.ok(workers.length >= 3, `expected the registered workers, parsed ${workers.length}`);
  const missing = workers.filter((name) => !doc.includes(`\`${name}\``));
  assert.deepEqual(missing, [], `docs/runtime-startup-supervision.md does not name: ${missing.join(", ")}`);
});

test("the signal shutdown observation budget in the document matches the coordinator", () => {
  const coordinator = read("src/lib/server/startup-worker-shutdown.ts");
  const budget = coordinator.match(/export const SIGNAL_SHUTDOWN_OBSERVATION_MS = ([\d_]+);/);
  assert.ok(budget, "SIGNAL_SHUTDOWN_OBSERVATION_MS must still be a literal");
  const seconds = Number(budget[1].replace(/_/g, "")) / 1000;
  assert.match(doc, new RegExp(`${seconds}\\s*s(?:econd)?`), `the document must state the ${seconds} s signal observation budget`);
});
