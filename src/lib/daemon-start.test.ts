// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";
import {
  parseDaemonLifecycleInspection,
  startLocalDaemon,
  terminateDaemonLaunchTree,
} from "./daemon-start.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";

const daemonStart = await readFile(new URL("./daemon-start.ts", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("./daemon-readiness.ts", import.meta.url), "utf8");
const covenDaemon = await readFile(new URL("./coven-daemon.ts", import.meta.url), "utf8");

assert.match(covenDaemon, /export function localDaemonTarget\(\)[\s\S]*mode: "local"[\s\S]*socketPath: socketPath\(\)/);
assert.match(daemonStart, /waitForDaemonReadiness/);
assert.match(daemonStart, /path: "\/api\/v1\/health"/);
assert.match(daemonStart, /detached: launchMode === "direct"/, "POSIX launch owns a process group");
assert.match(daemonStart, /taskkill/, "Windows timeout cleanup owns the shell process tree");
assert.match(daemonStart, /const cleanup = await terminateLaunchTree\(child\)/, "timeout cleanup is executed, not merely declared");
assert.match(readinessSource, /A final probe closes the race/);
assert.match(daemonStart, /sanitizeAboutDiagnosticText/, "daemon-start responses reuse the value-safe diagnostics sanitizer");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stdout\)/, "launcher stdout is redacted before it reaches a client");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stderr\)/, "launcher stderr is redacted before it reaches a client");

for (const [payload, expected] of [
  [{ status: "running", ok: true }, { status: "running" }],
  [{ status: "stopped", ok: false }, { status: "stopped" }],
  [{ status: "stale", ok: false, pid: 42 }, { status: "stale" }],
  [{ status: "future" }, { status: "unknown" }],
  [null, { status: "unknown" }],
]) {
  assert.deepEqual(parseDaemonLifecycleInspection(payload), expected);
}

function fakeChild(pid = 4321) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  return child;
}

{
  const safe = sanitizeAboutDiagnosticText(
    "failed at C:\\Users\\Example Person\\.npmrc token=ghp_1234567890abcdefghijklmnopqrstuv",
  );
  assert.doesNotMatch(safe, /Example Person|npmrc|ghp_/, "daemon start diagnostics redact local paths and credentials");
  assert.match(safe, /\[local path omitted\]|\[redacted\]/, "redaction remains apparent to the user");
}

test("a foreground launcher is successful as soon as health becomes ready", async () => {
  let now = 0;
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 3 }),
    timeoutMs: 1000,
    pollMs: 100,
    runnerExited: () => false,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.deepEqual(result, { ready: true, attempts: 3, elapsedMs: 200, runnerExited: false });
});

test("the deadline performs one final health probe before reporting timeout", async () => {
  let now = 0;
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 3 }),
    timeoutMs: 100,
    pollMs: 100,
    runnerExited: () => false,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.deepEqual(result, { ready: true, attempts: 3, elapsedMs: 100, runnerExited: false });
});

test("an exited launcher reports not-ready only after its final probe", async () => {
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 2 }),
    timeoutMs: 1000,
    pollMs: 100,
    runnerExited: () => true,
    now: () => 0,
    sleep: async () => assert.fail("an exited launcher should not sleep"),
  });
  assert.deepEqual(result, { ready: true, attempts: 2, elapsedMs: 0, runnerExited: true });
});

test("an exited launcher keeps probing through a bounded supervisor grace", async () => {
  let now = 0;
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 3 }),
    timeoutMs: 1000,
    pollMs: 100,
    runnerExitGraceMs: 200,
    runnerExited: () => true,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.deepEqual(result, { ready: true, attempts: 3, elapsedMs: 200, runnerExited: true });
});

for (const lifecycle of ["stale", "unknown"]) {
  test(`automatic recovery defers without spawning when lifecycle is ${lifecycle}`, async () => {
    let spawnCalls = 0;
    const result = await startLocalDaemon({
      automatic: true,
      probe: async () => ({ ok: false }),
      inspectLifecycle: async () => ({ status: lifecycle }),
      spawnImpl: () => {
        spawnCalls += 1;
        return fakeChild();
      },
    });

    assert.equal(spawnCalls, 0, "a live or unconfirmed owner must never get a competing daemon");
    assert.equal(result.ok, false);
    assert.equal(result.code, "owner_unreachable");
    assert.equal(result.status, 409);
    assert.equal(result.launchMode, "none");
  });
}

test("automatic recovery still starts after lifecycle proves stopped", async () => {
  const child = fakeChild();
  let spawnCalls = 0;
  let probes = 0;
  const result = await startLocalDaemon({
    automatic: true,
    probe: async () => ({ ok: ++probes >= 2 }),
    inspectLifecycle: async () => ({ status: "stopped" }),
    spawnImpl: () => {
      spawnCalls += 1;
      return child;
    },
  });

  assert.equal(spawnCalls, 1);
  assert.equal(result.ok, true);
});

test("a readiness timeout terminates the Windows launch tree", async () => {
  const child = fakeChild();
  let cleanupCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 0,
    probe: async () => ({ ok: false }),
    spawnImpl: () => child,
    terminateLaunchTree: async (launched) => {
      cleanupCalls += 1;
      assert.equal(launched, child, "the exact spawned launcher is cleaned up");
      return { attempted: true, completed: true, mode: "windows-tree" };
    },
    platform: "win32",
  });
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(result, {
    ok: false,
    code: "readiness_timeout",
    error: "daemon readiness timed out",
    stdout: "",
    stderr: "",
    status: 504,
    readinessAttempts: 3,
    elapsedMs: result.elapsedMs,
    launchMode: "shell",
    cleanup: { attempted: true, completed: true, mode: "windows-tree" },
  });
});

test("cleanup's own child close remains a readiness timeout", async () => {
  const child = fakeChild();
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 0,
    probe: async () => ({ ok: false }),
    spawnImpl: () => child,
    terminateLaunchTree: async () => {
      child.emit("close", null);
      return { attempted: true, completed: true, mode: "windows-tree" };
    },
    platform: "win32",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "readiness_timeout");
  assert.equal(result.status, 504);
  assert.deepEqual(result.cleanup, { attempted: true, completed: true, mode: "windows-tree" });
});

test("the pre-cleanup health probe preserves a daemon that becomes healthy at the deadline", async () => {
  const child = fakeChild();
  let probes = 0;
  let cleanupCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 0,
    probe: async () => ({ ok: ++probes === 3 }),
    spawnImpl: () => child,
    terminateLaunchTree: async () => {
      cleanupCalls += 1;
      return { attempted: true, completed: true, mode: "windows-tree" };
    },
    platform: "win32",
  });
  assert.equal(cleanupCalls, 0, "a final healthy probe must never be cleaned up");
  assert.equal(result.ok, true);
  assert.equal(result.readinessAttempts, 3);
});

test("an exited but unhealthy launcher is cleaned up before it is reported", async () => {
  const child = fakeChild();
  let cleanupCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 1,
    probe: async () => ({ ok: false }),
    spawnImpl: () => {
      queueMicrotask(() => child.emit("close", 1));
      return child;
    },
    terminateLaunchTree: async () => {
      cleanupCalls += 1;
      return { attempted: true, completed: true, mode: "windows-tree" };
    },
    platform: "win32",
  });
  assert.equal(cleanupCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "runner_exited");
  assert.deepEqual(result.cleanup, { attempted: true, completed: true, mode: "windows-tree" });
});

test("Windows cleanup delegates the complete owned tree to taskkill", async () => {
  const child = fakeChild(5199);
  let taskkillPid = null;
  const result = await terminateDaemonLaunchTree(child, {
    platform: "win32",
    terminateWindowsTree: async (pid) => {
      taskkillPid = pid;
      return true;
    },
  });
  assert.equal(taskkillPid, 5199);
  assert.deepEqual(result, { attempted: true, completed: true, mode: "windows-tree" });
});

test("POSIX cleanup escalates an owned process group when the launcher does not exit", async () => {
  const child = fakeChild(5200);
  const signals = [];
  let waits = 0;
  const result = await terminateDaemonLaunchTree(child, {
    platform: "linux",
    killProcessGroup: (pid, signal) => signals.push([pid, signal]),
    waitForExit: async () => ++waits === 2,
  });
  assert.deepEqual(signals, [[5200, "SIGTERM"], [5200, "SIGKILL"]]);
  assert.deepEqual(result, { attempted: true, completed: true, mode: "process-group" });
});

console.log("daemon-start.test.ts: ok");
