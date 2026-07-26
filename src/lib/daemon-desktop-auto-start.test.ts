// @ts-nocheck
import assert from "node:assert/strict";
import {
  createDaemonDesktopAutoStartCoordinator,
  createDaemonStatusRequestGate,
  daemonDesktopAutoStartDecision,
  runWorkspaceDaemonStart,
} from "./daemon-desktop-auto-start.ts";

const localOffline = { kind: "offline", targetMode: "local" };
const running = { kind: "running" };
const authExpired = { kind: "auth-expired" };
const unavailable = { kind: "unavailable", reason: "daemon timeout" };

for (const [name, platform, status, expected] of [
  ["desktop local offline", "desktop", localOffline, "start"],
  ["platform still resolving", "unknown", localOffline, "wait"],
  ["status still resolving", "desktop", null, "wait"],
  ["healthy desktop", "desktop", running, "skip"],
  ["desktop auth failure", "desktop", authExpired, "skip"],
  ["desktop unavailable", "desktop", unavailable, "skip"],
  ["plain browser", "browser", localOffline, "skip"],
  ["native iOS", "ios", localOffline, "skip"],
  ["native Android", "android", localOffline, "skip"],
  ["defensive non-local offline", "desktop", { kind: "offline", targetMode: "hub" }, "skip"],
]) {
  assert.equal(
    daemonDesktopAutoStartDecision({ platform, firstStatus: status }),
    expected,
    name,
  );
}

{
  let starts = 0;
  const coordinator = createDaemonDesktopAutoStartCoordinator(() => { starts += 1; });
  coordinator.observeStatus(localOffline);
  assert.equal(starts, 0, "offline status waits for asynchronous platform detection");
  coordinator.observePlatform("desktop");
  coordinator.observeStatus(localOffline);
  coordinator.observePlatform("desktop");
  assert.equal(starts, 1, "re-renders and later polls cannot duplicate the automatic start");
}

{
  let starts = 0;
  let coordinator;
  coordinator = createDaemonDesktopAutoStartCoordinator(() => {
    starts += 1;
    coordinator.observeStatus(localOffline);
    coordinator.observePlatform("desktop");
  });
  coordinator.observePlatform("desktop");
  coordinator.observeStatus(localOffline);
  assert.equal(starts, 1, "the latch is consumed before the start callback can re-enter");
}

{
  let starts = 0;
  const coordinator = createDaemonDesktopAutoStartCoordinator(() => { starts += 1; });
  coordinator.observeStatus(running);
  coordinator.observeStatus(localOffline);
  coordinator.observePlatform("desktop");
  coordinator.observeStatus(localOffline);
  assert.equal(starts, 0, "a healthy first decision prevents auto-restart after a later crash");
}

for (const [name, platform, status] of [
  ["browser", "browser", localOffline],
  ["iOS", "ios", localOffline],
  ["Android", "android", localOffline],
  ["auth", "desktop", authExpired],
  ["unavailable", "desktop", unavailable],
]) {
  let starts = 0;
  const coordinator = createDaemonDesktopAutoStartCoordinator(() => { starts += 1; });
  coordinator.observePlatform(platform);
  coordinator.observeStatus(status);
  coordinator.observeStatus(localOffline);
  assert.equal(starts, 0, `${name} consumes the launch decision without starting later`);
}

{
  const gate = createDaemonStatusRequestGate();
  const background = gate.begin();
  const trustedPostStart = gate.begin();
  assert.equal(gate.isLatest(background), false, "an older background result cannot publish after Start");
  assert.equal(gate.isLatest(trustedPostStart), true, "the trusted post-start result remains authoritative");
}

function response(ok, payload) {
  return { ok, json: async () => payload };
}

{
  const requests = [];
  const refreshes = [];
  let dismissed = 0;
  const errors = [];
  const ok = await runWorkspaceDaemonStart({
    fetchImpl: async function (...args) {
      assert.equal(this, undefined, "WebView fetch must not receive the dependency object as its receiver");
      requests.push(args);
      return response(true, { ok: true });
    },
    dismissError: () => { dismissed += 1; },
    reportError: (message) => errors.push(message),
    refreshStatus: async (opts) => { refreshes.push(opts); },
  });
  assert.equal(ok, true);
  assert.deepEqual(requests, [["/api/daemon/start", { method: "POST" }]], "automatic start never sends restart mode");
  assert.equal(dismissed, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(refreshes, [{ trusted: true }], "success performs the trusted refresh");
}

{
  const refreshes = [];
  const errors = [];
  let requests = 0;
  const deps = {
    fetchImpl: async () => {
      requests += 1;
      return response(false, { ok: false, error: "Coven CLI missing" });
    },
    dismissError: () => assert.fail("failure must not dismiss its diagnostic"),
    reportError: (message) => errors.push(message),
    refreshStatus: async (opts) => { refreshes.push(opts); },
  };
  assert.equal(await runWorkspaceDaemonStart(deps), false);
  assert.equal(await runWorkspaceDaemonStart(deps), false, "manual retry remains available after failure");
  assert.equal(requests, 2);
  assert.deepEqual(errors, ["Coven CLI missing", "Coven CLI missing"]);
  assert.deepEqual(refreshes, [undefined, undefined], "failure keeps ordinary status authoritative");
}

console.log("daemon-desktop-auto-start.test.ts: ok");
