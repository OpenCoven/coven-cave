// @ts-nocheck
import assert from "node:assert/strict";
import {
  createDaemonDesktopAutoStartCoordinator,
  createDaemonStatusRequestGate,
  daemonDesktopAutoStartDecision,
  runWorkspaceDaemonStart,
  DAEMON_RESTART_BACKOFF_MS,
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
  const outcome = await runWorkspaceDaemonStart({
    fetchImpl: async function (...args) {
      assert.equal(this, undefined, "WebView fetch must not receive the dependency object as its receiver");
      requests.push(args);
      return response(true, { ok: true });
    },
    dismissError: () => { dismissed += 1; },
    reportError: (message) => errors.push(message),
    refreshStatus: async (opts) => { refreshes.push(opts); },
  });
  assert.equal(outcome, "started");
  assert.deepEqual(requests, [["/api/daemon/start", { method: "POST" }]], "manual start keeps its existing request shape");
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
  assert.equal(await runWorkspaceDaemonStart(deps), "failed");
  assert.equal(await runWorkspaceDaemonStart(deps), "failed", "manual retry remains available after failure");
  assert.equal(requests, 2);
  assert.deepEqual(errors, ["Coven CLI missing", "Coven CLI missing"]);
  assert.deepEqual(refreshes, [undefined, undefined], "failure keeps ordinary status authoritative");
}

{
  const requests = [];
  const refreshes = [];
  const errors = [];
  const outcome = await runWorkspaceDaemonStart({
    automatic: true,
    fetchImpl: async (...args) => {
      requests.push(args);
      return response(false, {
        ok: false,
        code: "owner_unreachable",
        error: "automatic recovery deferred",
      });
    },
    dismissError: () => assert.fail("deferred recovery has no prior error to dismiss"),
    reportError: (message) => errors.push(message),
    refreshStatus: async (opts) => { refreshes.push(opts); },
  });

  assert.equal(outcome, "deferred");
  assert.deepEqual(requests, [["/api/daemon/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ automatic: true }),
  }]]);
  assert.deepEqual(errors, [], "automatic ownership deferral stays out of the error banner");
  assert.deepEqual(refreshes, [undefined], "deferral immediately rechecks ordinary connection state");
}


// ── Opt-in auto-restart (cave-bqywj) ────────────────────────────────────────
// Boot auto-start has always been one-shot: the coordinator consumes its
// decision and never reconsiders, so a daemon that dies an hour into a session
// stays dead. These pin the second half — and, just as importantly, pin that
// it stays OFF unless the user asked for it.

const OFFLINE = { kind: "offline", targetMode: "local" };
const RUNNING = { kind: "running", targetMode: "local" };

function restartHarness({ enabled = true, startClock = 0 } = {}) {
  let clock = startClock;
  const starts = [];
  const coordinator = createDaemonDesktopAutoStartCoordinator(
    () => starts.push(clock),
    { autoRestartEnabled: () => enabled, now: () => clock },
  );
  return {
    starts,
    coordinator,
    setEnabled(next) { enabled = next; },
    advance(ms) { clock += ms; },
  };
}

{
  // The behaviour the bead exists for: offline mid-session gets relaunched.
  const h = restartHarness();
  h.coordinator.observePlatform("desktop");
  h.coordinator.observeStatus(RUNNING);
  assert.deepEqual(h.starts, [], "a healthy daemon is left alone");
  h.advance(60_000);
  h.coordinator.observeStatus(OFFLINE);
  assert.equal(h.starts.length, 1, "a daemon that dies mid-session is restarted");
}
{
  // Off by default is the entire safety story — a disabled preference must not
  // restart anything, no matter how many polls report offline.
  const h = restartHarness({ enabled: false });
  h.coordinator.observePlatform("desktop");
  h.coordinator.observeStatus(RUNNING);
  for (let i = 0; i < 10; i += 1) {
    h.advance(600_000);
    h.coordinator.observeStatus(OFFLINE);
  }
  assert.deepEqual(h.starts, [], "opt-out means no unattended restarts at all");
}
{
  // The preference is read at decision time, not captured — turning it off
  // mid-session takes effect on the very next poll.
  const h = restartHarness();
  h.coordinator.observePlatform("desktop");
  h.coordinator.observeStatus(RUNNING);
  h.advance(60_000);
  h.coordinator.observeStatus(OFFLINE);
  assert.equal(h.starts.length, 1);
  h.setEnabled(false);
  h.advance(600_000);
  h.coordinator.observeStatus(OFFLINE);
  assert.equal(h.starts.length, 1, "turning the switch off stops the next restart");
}
{
  // Backoff, a bounded burst, and then MORE attempts after cooling off.
  //
  // This used to assert a permanent ceiling: four attempts and never again. The
  // ceiling was the bug — the only thing that reset the counter was a `running`
  // poll, which for a daemon that is genuinely gone never arrives, so the
  // familiar stayed down for the rest of the session with nothing further tried
  // and nothing on screen saying so. The budget now refills after a cooldown
  // (src/lib/familiar-liveness.ts).
  //
  // What must still hold is the thing the ceiling was protecting against: a
  // broken install must not be relaunched on every 5s poll.
  const h = restartHarness();
  h.coordinator.observePlatform("desktop");
  h.coordinator.observeStatus(RUNNING);
  for (let i = 0; i < 400; i += 1) {
    h.advance(5_000); // the real poll cadence
    h.coordinator.observeStatus(OFFLINE);
  }
  assert.ok(
    h.starts.length > DAEMON_RESTART_BACKOFF_MS.length,
    `the budget refills after cooling off, so a long outage keeps getting attempts (${h.starts.length})`,
  );
  assert.ok(
    h.starts.length < 20,
    `but nowhere near the 400 polls it saw — a crash loop still cannot spin (${h.starts.length})`,
  );
  // Jitter is [0.5, 1.5) of nominal, so the floor is half the scheduled wait.
  // Assert against the smallest in-burst delay: no two attempts are adjacent.
  const gaps = h.starts.slice(1).map((at, i) => at - h.starts[i]);
  for (const [i, gap] of gaps.entries()) {
    assert.ok(
      gap >= DAEMON_RESTART_BACKOFF_MS[1] / 2,
      `attempt ${i + 2} waited at least the jittered floor (${gap})`,
    );
  }
}
{
  // Recovery resets the budget: a later, unrelated outage gets a full set of
  // attempts rather than the exhausted tail of the previous one.
  const h = restartHarness();
  h.coordinator.observePlatform("desktop");
  h.coordinator.observeStatus(RUNNING);
  for (let i = 0; i < 400; i += 1) {
    h.advance(5_000);
    h.coordinator.observeStatus(OFFLINE);
  }
  const exhausted = h.starts.length;
  h.advance(5_000);
  h.coordinator.observeStatus(RUNNING);
  h.advance(5_000);
  h.coordinator.observeStatus(OFFLINE);
  assert.equal(h.starts.length, exhausted + 1, "a recovered daemon restores the attempt budget");
}
{
  // Scope guards: never on mobile, never for a hub target, and never a second
  // start on the same observation that boot already acted on.
  const mobile = restartHarness();
  mobile.coordinator.observePlatform("mobile");
  mobile.coordinator.observeStatus(OFFLINE);
  mobile.advance(600_000);
  mobile.coordinator.observeStatus(OFFLINE);
  assert.deepEqual(mobile.starts, [], "mobile never auto-starts a local daemon");

  const boot = restartHarness();
  boot.coordinator.observePlatform("desktop");
  boot.coordinator.observeStatus(OFFLINE);
  assert.equal(boot.starts.length, 1, "boot start fires exactly once, not twice");
}
{
  // No options → the old one-shot coordinator, byte for byte in behaviour.
  const starts = [];
  const coordinator = createDaemonDesktopAutoStartCoordinator(() => starts.push(1));
  coordinator.observePlatform("desktop");
  coordinator.observeStatus(RUNNING);
  for (let i = 0; i < 5; i += 1) coordinator.observeStatus(OFFLINE);
  assert.deepEqual(starts, [], "without opt-in wiring the coordinator stays one-shot");
}

console.log("daemon-desktop-auto-start.test.ts: ok");
