import assert from "node:assert/strict";
import {
  daemonUpdateTraceLine,
  markDaemonCliInstalling,
  prepareDaemonForCliUpdate,
  recoverDaemonAfterCliUpdate,
  type DaemonHealth,
  type DaemonUpdateDependencies,
} from "./daemon-update-lifecycle.ts";

assert.equal(
  daemonUpdateTraceLine({
    wasRunning: false,
    phase: "not-running",
    health: "stopped",
    detail: "The local daemon was already stopped.",
  }),
  "Daemon update status: The local daemon was already stopped.\n",
  "already-punctuated lifecycle details do not gain a second period",
);
assert.equal(
  daemonUpdateTraceLine({ wasRunning: true, phase: "installing", health: "stopped" }),
  "Daemon update status: installing.\n",
  "phase fallbacks gain one terminal period",
);

function depsFor({
  health,
  stop = { ok: true },
  start = { ok: true },
}: {
  health: DaemonHealth[];
  stop?: { ok: boolean; detail?: string };
  start?: { ok: boolean; detail?: string };
}) {
  const calls = { stop: 0, start: 0, refresh: 0 };
  let healthIndex = 0;
  const deps: DaemonUpdateDependencies = {
    checkHealth: async () => health[Math.min(healthIndex++, health.length - 1)]!,
    stop: async () => {
      calls.stop++;
      return stop;
    },
    start: async () => {
      calls.start++;
      return start;
    },
    refreshExecutable: () => {
      calls.refresh++;
    },
    wait: async () => {},
    stopPollAttempts: 2,
    restartPollAttempts: 2,
    pollDelayMs: 0,
  };
  return { deps, calls };
}

// Running -> stop -> install -> restart -> verified healthy.
{
  const { deps, calls } = depsFor({
    health: [{ ok: true }, { ok: false, detail: "daemon offline" }, { ok: true }],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, true);
  assert.equal(prepared.lifecycle.wasRunning, true);
  assert.equal(prepared.lifecycle.phase, "stopped");
  const recovered = await recoverDaemonAfterCliUpdate(markDaemonCliInstalling(prepared.lifecycle), deps);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lifecycle.phase, "healthy");
  assert.deepEqual(calls, { stop: 1, start: 1, refresh: 1 });
}

// Intentionally stopped stays stopped: no stop, refresh, or start action.
{
  const { deps, calls } = depsFor({ health: [{ ok: false, detail: "daemon offline" }] });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, true);
  assert.equal(prepared.lifecycle.wasRunning, false);
  assert.equal(prepared.lifecycle.health, "stopped");
  const recovered = await recoverDaemonAfterCliUpdate(prepared.lifecycle, deps);
  assert.equal(recovered.ok, true);
  assert.deepEqual(calls, { stop: 0, start: 0, refresh: 0 });
}

// A stop failure that leaves the daemon healthy aborts before npm; no PID kill
// fallback exists in this lifecycle helper, which also covers PID reuse.
{
  const { deps, calls } = depsFor({
    health: [{ ok: true }, { ok: true }, { ok: true }],
    stop: { ok: false, detail: "exit 1" },
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, false);
  assert.equal(prepared.lifecycle.phase, "stop-failed");
  assert.deepEqual(calls, { stop: 1, start: 0, refresh: 0 });
}

// A PID reported before stop may be reused by another process. The lifecycle
// deliberately treats it as diagnostics only and refuses the update while the
// local health endpoint remains alive instead of signalling that PID.
{
  const { deps, calls } = depsFor({
    health: [{ ok: true, pid: 4242 }, { ok: true, pid: 4242 }, { ok: true, pid: 4242 }],
    stop: { ok: false, detail: "exit 1" },
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, false);
  assert.equal(prepared.lifecycle.phase, "stop-failed");
  assert.deepEqual(calls, { stop: 1, start: 0, refresh: 0 });
}

// Supervised daemon: a clean stop followed by a NEW pid proves the old process
// exited and a supervisor (launchd/systemd/watchdog) relaunched it. The update
// proceeds, and recovery bounces the daemon onto the freshly installed CLI.
{
  const { deps, calls } = depsFor({
    health: [
      { ok: true, pid: 100 }, // before stop
      { ok: true, pid: 200 }, // still up after stop — supervisor relaunch
      { ok: true, pid: 200 },
      { ok: true, pid: 200 }, // recovery pre-bounce probe
      { ok: true, pid: 300 }, // supervisor relaunch on the updated CLI
    ],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, true, "a proven supervisor restart must not block the update");
  assert.equal(prepared.lifecycle.phase, "supervised");
  assert.equal(prepared.lifecycle.supervised, true);
  assert.equal(prepared.lifecycle.health, "running");
  const installing = markDaemonCliInstalling(prepared.lifecycle);
  assert.equal(installing.phase, "installing");
  assert.equal(installing.health, "running", "a supervised daemon keeps running during install");
  const recovered = await recoverDaemonAfterCliUpdate(installing, deps);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lifecycle.phase, "healthy");
  assert.match(recovered.lifecycle.detail ?? "", /supervised/);
  assert.deepEqual(calls, { stop: 2, start: 0, refresh: 1 }, "bounce reuses graceful stop; never a PID signal");
}

// A clean stop with an UNCHANGED pid is not supervision evidence — the daemon
// simply never stopped, so the update stays blocked.
{
  const { deps, calls } = depsFor({
    health: [{ ok: true, pid: 100 }, { ok: true, pid: 100 }, { ok: true, pid: 100 }],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, false);
  assert.equal(prepared.lifecycle.phase, "stop-failed");
  assert.deepEqual(calls, { stop: 1, start: 0, refresh: 0 });
}

// A failed stop command never classifies as supervised, even when the pid
// changed — without a clean stop the relaunch proof does not hold.
{
  const { deps } = depsFor({
    health: [{ ok: true, pid: 100 }, { ok: true, pid: 200 }, { ok: true, pid: 200 }],
    stop: { ok: false, detail: "exit 1" },
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, false);
  assert.equal(prepared.lifecycle.phase, "stop-failed");
}

// Missing pid data on either probe keeps the conservative stop-failed path.
{
  const { deps } = depsFor({
    health: [{ ok: true }, { ok: true, pid: 200 }, { ok: true, pid: 200 }],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, false);
  assert.equal(prepared.lifecycle.phase, "stop-failed");
}

// Supervised recovery where the bounce does not take (pid never changes) is an
// honest failure: the daemon may still be running the previous CLI version.
{
  const { deps, calls } = depsFor({
    health: [
      { ok: true, pid: 100 },
      { ok: true, pid: 200 },
      { ok: true, pid: 200 }, // clamps: pre-bounce and every relaunch poll stay pid 200
    ],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.lifecycle.phase, "supervised");
  const recovered = await recoverDaemonAfterCliUpdate(markDaemonCliInstalling(prepared.lifecycle), deps);
  assert.equal(recovered.ok, false);
  assert.equal(recovered.lifecycle.phase, "recovery-failed");
  assert.equal(recovered.lifecycle.health, "running");
  assert.match(recovered.lifecycle.detail ?? "", /previous version/);
  assert.deepEqual(calls, { stop: 2, start: 0, refresh: 1 });
}

// Supervised daemon whose supervisor vanished mid-update: the bounce brings it
// down and nothing relaunches it, so recovery starts it directly.
{
  const { deps, calls } = depsFor({
    health: [
      { ok: true, pid: 100 },
      { ok: true, pid: 200 },
      { ok: true, pid: 200 },
      { ok: true, pid: 200 }, // recovery pre-bounce probe
      { ok: false },          // bounce landed; supervisor never relaunches
      { ok: false },
      { ok: true, pid: 300 }, // direct start on the updated CLI
    ],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.lifecycle.phase, "supervised");
  const recovered = await recoverDaemonAfterCliUpdate(markDaemonCliInstalling(prepared.lifecycle), deps);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lifecycle.phase, "healthy");
  assert.deepEqual(calls, { stop: 2, start: 1, refresh: 1 });
}

// An npm install failure still gets the previously running daemon restored.
{
  const { deps, calls } = depsFor({
    health: [{ ok: true }, { ok: false }, { ok: true }],
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  assert.equal(prepared.canInstall, true);
  const recovered = await recoverDaemonAfterCliUpdate(markDaemonCliInstalling(prepared.lifecycle), deps);
  assert.equal(recovered.ok, true, "recovery runs independently of npm success");
  assert.equal(recovered.lifecycle.health, "running");
  assert.deepEqual(calls, { stop: 1, start: 1, refresh: 1 });
}

// Restart failures are explicit and preserve the final daemon health.
{
  const { deps } = depsFor({
    health: [{ ok: true }, { ok: false }, { ok: false, detail: "daemon offline" }],
    start: { ok: false, detail: "exit 1" },
  });
  const prepared = await prepareDaemonForCliUpdate(deps);
  const recovered = await recoverDaemonAfterCliUpdate(markDaemonCliInstalling(prepared.lifecycle), deps);
  assert.equal(recovered.ok, false);
  assert.equal(recovered.lifecycle.phase, "recovery-failed");
  assert.equal(recovered.lifecycle.health, "stopped");
  assert.match(recovered.lifecycle.detail ?? "", /coven daemon start/);
}

console.log("daemon-update-lifecycle.test.ts: ok");
