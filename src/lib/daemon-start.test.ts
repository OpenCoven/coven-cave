// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";
import {
  directDaemonLaunchCommand,
  parseDaemonLifecycleInspection,
  startLocalDaemon,
  terminateDaemonLaunchTree,
} from "./daemon-start.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";
import {
  clearDaemonDiagnosticEventsForTests,
  createDaemonDiagnosticContext,
  listDaemonDiagnosticEvents,
} from "./server/daemon-diagnostics.ts";

const daemonStart = await readFile(new URL("./daemon-start.ts", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("./daemon-readiness.ts", import.meta.url), "utf8");
const covenDaemon = await readFile(new URL("./coven-daemon.ts", import.meta.url), "utf8");

assert.match(covenDaemon, /export function localDaemonTarget\(\)[\s\S]*mode: "local"[\s\S]*socketPath: socketPath\(\)/);
assert.match(daemonStart, /waitForDaemonReadiness/);
assert.match(daemonStart, /runnerExitGraceMs: startTimeoutMs/, "the daemonizing CLI launcher gets the complete health deadline");
assert.match(daemonStart, /path: "\/api\/v1\/health"/);
assert.match(daemonStart, /detached: platform !== "win32"/, "POSIX launch owns a process group");
assert.match(daemonStart, /windowsHide: true/, "daemon launch suppresses Windows console allocation");
assert.doesNotMatch(daemonStart, /shell: launch\.unresolvedWindowsShim/, "unresolved Windows shims never fall back to cmd.exe");
assert.match(daemonStart, /taskkill/, "Windows timeout cleanup owns the shell process tree");
assert.match(daemonStart, /const cleanup = await terminateLaunchTree\(child\)/, "timeout cleanup is executed, not merely declared");
assert.match(readinessSource, /A final probe closes the race/);
assert.match(daemonStart, /sanitizeAboutDiagnosticText/, "daemon-start responses reuse the value-safe diagnostics sanitizer");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stdout\)/, "launcher stdout is redacted before it reaches a client");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stderr\)/, "launcher stderr is redacted before it reaches a client");
assert.match(daemonStart, /assessDaemonStartupCompatibility/, "readiness must validate runtime coherence, not only socket reachability");
assert.match(daemonStart, /code: "runtime_incompatible"/, "a stale or incompatible runtime has a stable actionable outcome");
assert.match(daemonStart, /RuntimeStartupCoordinator/, "duplicate launches and repeated failures share one bounded startup lane");
assert.match(daemonStart, /code: "address_in_use"/, "an address someone else holds has its own actionable outcome");
assert.match(daemonStart, /inspectDaemonAddress/, "occupancy is proven by connecting, not inferred from a failed health probe");
assert.match(daemonStart, /daemonStartCoordinator\.run/, "production starts enter the shared coordinator");

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

test("daemon startup propagates one correlation into the CLI child and lifecycle events", async () => {
  clearDaemonDiagnosticEventsForTests();
  const diagnostics = createDaemonDiagnosticContext({
    correlationId: "55555555-5555-4555-8555-555555555555",
    generation: 4,
  });
  let spawnEnv: NodeJS.ProcessEnv | undefined;
  const result = await startLocalDaemon({
    restart: true,
    diagnostics,
    startTimeoutMs: 50,
    readinessPollMs: 1,
    probe: async () => ({ ok: true }),
    spawnImpl: (_command, _args, options) => {
      spawnEnv = options.env;
      return fakeChild();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(spawnEnv?.COVEN_CAVE_CORRELATION_ID, diagnostics.correlationId);
  assert.equal(spawnEnv?.COVEN_CAVE_DIAGNOSTIC_GENERATION, "4");
  assert.equal(spawnEnv?.COVEN_CAVE_DIAGNOSTIC_OPERATION, "daemon-start");
  const events = listDaemonDiagnosticEvents();
  assert.deepEqual(
    events.map(({ correlationId, generation, operation, phase, outcome }) => ({
      correlationId,
      generation,
      operation,
      phase,
      outcome,
    })),
    [
      {
        correlationId: "55555555-5555-4555-8555-555555555555",
        generation: 4,
        operation: "daemon-start",
        phase: "startup",
        outcome: "started",
      },
      {
        correlationId: "55555555-5555-4555-8555-555555555555",
        generation: 4,
        operation: "daemon-start",
        phase: "startup",
        outcome: "succeeded",
      },
    ],
  );
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

test("an automatic request cannot use restart to skip the lifecycle preflight", async () => {
  let spawnCalls = 0;
  const result = await startLocalDaemon({
    automatic: true,
    restart: true,
    probe: async () => ({ ok: false }),
    inspectLifecycle: async () => ({ status: "stale" }),
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild();
    },
  });

  assert.equal(spawnCalls, 0, "restart must not let an automatic request bypass the fail-closed preflight");
  assert.equal(result.ok, false);
  assert.equal(result.code, "owner_unreachable");
});

test("automatic recovery still starts after lifecycle proves stopped", async () => {
  const child = fakeChild();
  let spawnCalls = 0;
  let probes = 0;
  const result = await startLocalDaemon({
    automatic: true,
    probe: async () => ({ ok: ++probes >= 2 }),
    inspectLifecycle: async () => ({ status: "stopped" }),
    // Declared, not defaulted: the real probe would connect to this machine's
    // own daemon socket and refuse, making the result depend on whether the
    // developer running the suite happens to have a daemon up.
    inspectAddress: async () => "free",
    spawnImpl: () => {
      spawnCalls += 1;
      return child;
    },
  });

  assert.equal(spawnCalls, 1);
  assert.equal(result.ok, true);
});

test("daemon command resolution launches a proven shim target directly", () => {
  assert.deepEqual(
    directDaemonLaunchCommand({ command: process.execPath, fixedArgs: ["C:\\tools\\coven.js"] }),
    {
      command: process.execPath,
      args: ["C:\\tools\\coven.js", "daemon", "start"],
      shell: false,
    },
  );
  assert.throws(
    () => directDaemonLaunchCommand({
      command: "C:\\Users\\example\\AppData\\Roaming\\npm\\coven.cmd",
      fixedArgs: [],
      unresolvedWindowsShim: true,
    }),
    /could not safely resolve the Coven Windows command shim/i,
  );
});

test("Windows daemon launch is hidden, shell-free, and signals the native wrapper", async () => {
  const child = fakeChild();
  let seen: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
  const result = await startLocalDaemon({
    restart: true,
    probe: async () => ({ ok: true }),
    platform: "win32",
    launchCommand: () => ({ command: process.execPath, args: ["coven.js", "daemon", "start"], shell: false }),
    spawnEnvironment: () => ({ PATH: "C:\\Windows\\System32" }),
    spawnImpl: (command, args, options) => {
      seen = { command, args, options: options as Record<string, unknown> };
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.launchMode, "direct");
  assert.equal(seen?.options.windowsHide, true);
  assert.equal(seen?.options.shell, false);
  assert.equal(seen?.options.detached, false);
  assert.equal(
    (seen?.options.env as NodeJS.ProcessEnv).COVEN_WINDOWS_HIDE_NATIVE_WINDOW,
    "1",
  );
});

test("an injected shell fallback is refused before spawn", async () => {
  let spawnCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    probe: async () => ({ ok: false }),
    platform: "win32",
    launchCommand: () => ({ command: "coven.cmd", args: ["daemon", "start"], shell: true }),
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild();
    },
  });
  assert.equal(spawnCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "spawn_failed");
  assert.equal(result.launchMode, "direct");
  assert.match(result.error, /could not safely resolve the Coven Windows command shim/i);
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
    launchMode: "direct",
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

test("an occupied-address launcher failure is named, not reported as a bare early exit", async () => {
  const child = fakeChild();
  let cleanupCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 1,
    probe: async () => ({ ok: false }),
    spawnImpl: () => {
      queueMicrotask(() => {
        child.stderr.write("listen EADDRINUSE: address already in use");
        child.emit("close", 1);
      });
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
  assert.equal(result.code, "address_in_use", "the launcher's own bind failure outranks the exit it caused");
  assert.equal(result.status, 409);
  assert.match(result.error, /already using the local Coven daemon address/i);
  assert.match(result.error, /then try again/i, "the diagnostic carries one next step");
  assert.match(result.stderr, /EADDRINUSE|address already in use/, "the raw launcher output stays diagnosable");
  assert.deepEqual(result.cleanup, { attempted: true, completed: true, mode: "windows-tree" });
});

test("an already-bound address is refused by name instead of spawning a doomed launcher", async () => {
  let spawnCalls = 0;
  const result = await startLocalDaemon({
    probe: async () => ({ ok: false }),
    inspectAddress: async () => "occupied",
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild();
    },
  });

  assert.equal(spawnCalls, 0, "a launcher that cannot win its own bind must never be started");
  assert.equal(result.ok, false);
  assert.equal(result.code, "address_in_use");
  assert.equal(result.status, 409);
  assert.equal(result.launchMode, "none");
  assert.match(result.error, /already using the local Coven daemon address/i);
  assert.doesNotMatch(result.error, /[\\/]/, "the diagnostic never carries a socket path across the API boundary");
});

for (const occupancy of ["free", "unknown"]) {
  test(`a ${occupancy} address still launches`, async () => {
    let spawnCalls = 0;
    let probes = 0;
    const child = fakeChild();
    const result = await startLocalDaemon({
      probe: async () => ({ ok: ++probes >= 2 }),
      inspectAddress: async () => occupancy,
      spawnImpl: () => {
        spawnCalls += 1;
        return child;
      },
    });

    assert.equal(spawnCalls, 1, "only proven occupancy refuses; an unreadable address must not strand a start");
    assert.equal(result.ok, true);
  });
}

test("restart never consults occupancy, because the occupant is what it replaces", async () => {
  let inspections = 0;
  let probes = 0;
  const child = fakeChild();
  const result = await startLocalDaemon({
    restart: true,
    probe: async () => ({ ok: ++probes >= 2 }),
    inspectAddress: async () => {
      inspections += 1;
      return "occupied";
    },
    spawnImpl: () => child,
  });

  assert.equal(inspections, 0, "a restart that refused its own daemon's address could never restart anything");
  assert.equal(result.ok, true);
});

test("automatic recovery checks lifecycle ownership before it checks the address", async () => {
  const order = [];
  let spawnCalls = 0;
  const result = await startLocalDaemon({
    automatic: true,
    probe: async () => ({ ok: false }),
    inspectLifecycle: async () => {
      order.push("lifecycle");
      return { status: "stopped" };
    },
    inspectAddress: async () => {
      order.push("address");
      return "occupied";
    },
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild();
    },
  });

  assert.deepEqual(order, ["lifecycle", "address"], "a live owner is the more specific answer and reports first");
  assert.equal(spawnCalls, 0);
  assert.equal(result.code, "address_in_use");
});

test("a daemon runtime on an independent release line is adopted after launch", async () => {
  const child = fakeChild();
  let cleanupCalls = 0;
  const result = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 0,
    readHealthDocument: async () => ({
      ok: true,
      apiVersion: "coven.daemon.v1",
      covenVersion: "0.0.0",
    }),
    spawnImpl: () => child,
    terminateLaunchTree: async () => {
      cleanupCalls += 1;
      return { attempted: true, completed: true, mode: "process-group" };
    },
    platform: "linux",
  });

  assert.equal(cleanupCalls, 0);
  assert.equal(result.ok, true);
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
  const result = await terminateDaemonLaunchTree(child, {
    platform: "linux",
    killProcessGroup: (pid, signal) => signals.push([pid, signal]),
    waitForExit: async () => true,
    processGroupAlive: () => true,
    waitForProcessGroupExit: async () => true,
  });
  assert.deepEqual(signals, [[5200, "SIGTERM"], [5200, "SIGKILL"]]);
  assert.deepEqual(result, { attempted: true, completed: true, mode: "process-group" });
});

console.log("daemon-start.test.ts: ok");
