// @ts-nocheck
// #5649: non-urgent loaders wait out app load; the gate opens shortly after the
// first transcript paints, or after a ceiling, and then stays open.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;
const gate = await import("./startup-gate.ts");

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("waiters open STARTUP_SETTLE_MS after the first transcript paints", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  gate.resetStartupGateForTests();
  let opened = false;
  void gate.whenStartupSettled().then(() => { opened = true; });
  gate.markStartupSettled();
  t.mock.timers.tick(gate.STARTUP_SETTLE_MS - 1);
  await tick();
  assert.equal(opened, false, "the painting chat's own requests go first");
  t.mock.timers.tick(1);
  await tick();
  assert.equal(opened, true);
  let later = false;
  void gate.whenStartupSettled().then(() => { later = true; });
  await tick();
  assert.equal(later, true, "once open it stays open");
});

test("a page that never opens a chat opens the gate at the ceiling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  gate.resetStartupGateForTests();
  let opened = false;
  void gate.whenStartupSettled().then(() => { opened = true; });
  t.mock.timers.tick(gate.STARTUP_GATE_MAX_MS - 1);
  await tick();
  assert.equal(opened, false);
  t.mock.timers.tick(1);
  await tick();
  assert.equal(opened, true);
});

test("the ceiling bounds a slow first paint", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  gate.resetStartupGateForTests();
  let opened = false;
  void gate.whenStartupSettled().then(() => { opened = true; });
  t.mock.timers.tick(gate.STARTUP_GATE_MAX_MS);
  await tick();
  assert.equal(opened, true);
  gate.markStartupSettled();
});
