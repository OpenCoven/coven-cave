import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  sanitizeDaemonStartDiagnostic,
  startLocalDaemon,
} from "../src/lib/daemon-start.ts";
import {
  createDaemonConnectionSupervisor,
  type DaemonConnectionPoll,
} from "../src/lib/daemon-connection-supervisor.ts";
import { waitForDaemonReadiness } from "../src/lib/daemon-readiness.ts";
import {
  RuntimeStartupCoordinator,
  RuntimeStartupThrottle,
} from "../src/lib/runtime-startup-throttle.ts";

const fixtureLaunch = () => ({
  command: process.execPath,
  args: ["daemon-connectivity-fault-fixture"],
});
const fixtureEnvironment = (): NodeJS.ProcessEnv => ({ NODE_ENV: "test" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function fakeChild(pid = 43_210): ChildProcess {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: pid });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`owned fixture process ${pid} survived cleanup`);
}

test("delayed readiness, partial health, crash, hang, reset, and version skew stay distinct", async () => {
  let now = 0;
  let probes = 0;
  const delayed = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 4 }),
    timeoutMs: 500,
    pollMs: 100,
    runnerExited: () => false,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  assert.deepEqual(delayed, {
    ready: true,
    attempts: 4,
    elapsedMs: 300,
    runnerExited: false,
  });

  for (const [name, health, expectedCode] of [
    ["partial", { ok: true }, "runtime_incompatible"],
    ["version-skew", { ok: true, apiVersion: "v1", covenVersion: "1.2.2" }, "runtime_incompatible"],
  ] as const) {
    const result = await startLocalDaemon({
      restart: true,
      startTimeoutMs: 0,
      installedVersion: async () => "1.2.3",
      readHealthDocument: async () => health,
      launchCommand: fixtureLaunch,
      spawnEnvironment: fixtureEnvironment,
      spawnImpl: () => fakeChild(),
      terminateLaunchTree: async () => ({
        attempted: true,
        completed: true,
        mode: process.platform === "win32" ? "windows-tree" : "process-group",
      }),
      platform: process.platform,
    });
    assert.equal(result.ok, false, `${name} must fail closed`);
    assert.equal(result.code, expectedCode);
    assert.equal(result.cleanup?.completed, true);
  }

  const crashed = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 1,
    probe: async () => ({ ok: false }),
    launchCommand: fixtureLaunch,
    spawnEnvironment: fixtureEnvironment,
    spawnImpl: () => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.emit("close", 17);
      });
      return child;
    },
    terminateLaunchTree: async () => ({
      attempted: true,
      completed: true,
      mode: process.platform === "win32" ? "windows-tree" : "process-group",
    }),
    platform: process.platform,
  });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.code, "runner_exited");

  const hung = await startLocalDaemon({
    restart: true,
    startTimeoutMs: 0,
    probe: async () => ({ ok: false }),
    launchCommand: fixtureLaunch,
    spawnEnvironment: fixtureEnvironment,
    spawnImpl: () => fakeChild(),
    terminateLaunchTree: async () => ({
      attempted: true,
      completed: true,
      mode: process.platform === "win32" ? "windows-tree" : "process-group",
    }),
    platform: process.platform,
  });
  assert.equal(hung.ok, false);
  assert.equal(hung.code, "readiness_timeout");
  assert.equal(hung.cleanup?.completed, true);

  for (const lifecycle of ["stale", "unknown"] as const) {
    let launches = 0;
    const reset = await startLocalDaemon({
      automatic: true,
      probe: async () => ({ ok: false }),
      inspectLifecycle: async () => ({ status: lifecycle }),
      launchCommand: fixtureLaunch,
      spawnEnvironment: fixtureEnvironment,
      spawnImpl: () => {
        launches += 1;
        return fakeChild();
      },
      platform: process.platform,
    });
    assert.equal(reset.ok, false);
    assert.equal(reset.code, "owner_unreachable");
    assert.equal(launches, 0, `${lifecycle} ownership must suppress a duplicate launch`);
  }
});

test("permission ambiguity remains retryable and unusual paths are not exposed", async () => {
  let probes = 0;
  let launches = 0;
  const result = await startLocalDaemon({
    probe: async () => ({ ok: ++probes >= 2 }),
    inspectAddress: async () => "unknown",
    launchCommand: fixtureLaunch,
    spawnEnvironment: fixtureEnvironment,
    spawnImpl: () => {
      launches += 1;
      return fakeChild();
    },
    platform: process.platform,
  });
  assert.equal(result.ok, true);
  assert.equal(launches, 1, "an unreadable socket is not proof that another daemon owns it");

  const diagnostic = sanitizeDaemonStartDiagnostic(
    "failed at /Users/Example Person/Coven Cave/socket token=secret-value-that-must-not-escape",
  );
  assert.doesNotMatch(diagnostic, /Example Person|secret-value|Coven Cave\/socket/);
  assert.match(diagnostic, /\[local path omitted\]|\[redacted\]/);
});

test("resolved Windows launch paths stay structured instead of passing through cmd.exe", async () => {
  const command = String.raw`C:\Program Files\Coven Runtime\node.exe`;
  const args = [String.raw`C:\Users\Example Person\App Data\coven.js`, "daemon", "start"];
  let observed: { command: string; args: string[]; shell: unknown } | null = null;
  let probes = 0;
  const result = await startLocalDaemon({
    restart: true,
    probe: async () => ({ ok: ++probes >= 2 }),
    launchCommand: () => ({ command, args }),
    spawnEnvironment: fixtureEnvironment,
    spawnImpl: (spawnCommand, spawnArgs, options) => {
      observed = { command: spawnCommand, args: spawnArgs, shell: options.shell };
      return fakeChild();
    },
    platform: "win32",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observed, { command, args, shell: false });
});

test("duplicate launches coalesce and repeated failures consume one bounded lane", async () => {
  const throttle = new RuntimeStartupThrottle(2, 60_000);
  const coordinator = new RuntimeStartupCoordinator<{ ok: boolean; code: string }>(throttle);
  const pending = deferred<{ ok: boolean; code: string }>();
  let operations = 0;
  const run = () => coordinator.run(
    () => {
      operations += 1;
      return pending.promise;
    },
    () => ({ ok: false, code: "restart_throttled" }),
    (result) => result.ok,
  );

  const first = run();
  const duplicate = run();
  assert.equal(first, duplicate);
  assert.equal(operations, 1, "concurrent callers must share one launch");
  pending.resolve({ ok: false, code: "readiness_timeout" });
  await first;

  const recovered = await coordinator.run(
    async () => ({ ok: true, code: "ready" }),
    () => ({ ok: false, code: "restart_throttled" }),
    (result) => result.ok,
  );
  assert.equal(recovered.ok, true, "a proven recovery resets the earlier failure");

  for (const code of ["runner_exited", "readiness_timeout"]) {
    const failed = await coordinator.run(
      async () => ({ ok: false, code }),
      () => ({ ok: false, code: "restart_throttled" }),
      (result) => result.ok,
    );
    assert.equal(failed.code, code);
  }
  const throttled = await coordinator.run(
    async () => {
      assert.fail("a spent restart budget must not launch");
    },
    () => ({ ok: false, code: "restart_throttled" }),
    (result) => result.ok,
  );
  assert.equal(throttled.code, "restart_throttled");
  const asynchronousFailure = coordinator.run(
    async () => {
      assert.fail("a spent restart budget must not launch");
    },
    () => {
      throw new Error("throttled result construction failed");
    },
    (result) => result.ok,
  );
  await assert.rejects(asynchronousFailure, /throttled result construction failed/);
});

test("sleep, wake, cancellation, and stale completions keep only the newest endpoint", async () => {
  const requests: Array<{
    signal: AbortSignal;
    fresh: boolean;
    result: ReturnType<typeof deferred<DaemonConnectionPoll>>;
  }> = [];
  const publications: DaemonConnectionPoll[] = [];
  const supervisor = createDaemonConnectionSupervisor<number>({
    request({ signal, fresh }) {
      const result = deferred<DaemonConnectionPoll>();
      requests.push({ signal, fresh, result });
      return result.promise;
    },
    publish(poll) {
      publications.push(poll);
    },
    schedule: () => 1,
    cancelSchedule: () => {},
  });

  supervisor.start();
  assert.equal(requests.length, 1);
  supervisor.setVisible(false);
  assert.equal(requests[0]?.signal.aborted, true, "sleep/background must cancel active work");
  supervisor.setVisible(true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.fresh, true, "wake/foreground must force a fresh endpoint probe");

  requests[1]?.result.resolve({
    responseStatus: 200,
    responseOk: true,
    payload: { running: true, target: { mode: "local", endpoint: "new" } },
  });
  await Promise.resolve();
  await Promise.resolve();
  requests[0]?.result.resolve({
    responseStatus: 200,
    responseOk: true,
    payload: { running: true, target: { mode: "local", endpoint: "stale" } },
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(publications.length, 1);
  assert.deepEqual(publications[0]?.payload, {
    running: true,
    target: { mode: "local", endpoint: "new" },
  });
  supervisor.stop();
});

test("repeated actual startup cleanup leaves no root or descendant process", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "coven cave faults-"));
  const fixture = path.join(fixtureRoot, "owned tree.cjs");
  const marker = path.join(fixtureRoot, "descendant.pid");
  await writeFile(
    fixture,
    [
      "const { spawn } = require('node:child_process');",
      `const { writeFileSync } = require('node:fs');`,
      `const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });`,
      `writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid, descendant: child.pid }));`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8",
  );

  try {
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await rm(marker, { force: true });
      const tracked = new Set<number>();
      try {
        const result = await startLocalDaemon({
          restart: true,
          startTimeoutMs: 500,
          readinessPollMs: 25,
          probe: async () => ({ ok: false }),
          launchCommand: () => ({ command: process.execPath, args: [fixture] }),
          spawnEnvironment: () => ({ ...process.env, NODE_ENV: "test" }),
          platform: process.platform,
        });
        assert.equal(result.ok, false);
        assert.equal(result.code, "readiness_timeout");
        assert.deepEqual(result.cleanup, {
          attempted: true,
          completed: true,
          mode: process.platform === "win32" ? "windows-tree" : "process-group",
        });

        const pids = JSON.parse(await readFile(marker, "utf8")) as {
          root: number;
          descendant: number;
        };
        tracked.add(pids.root);
        tracked.add(pids.descendant);
        await waitForProcessExit(pids.root);
        await waitForProcessExit(pids.descendant);
      } finally {
        const raw = await readFile(marker, "utf8").catch(() => "");
        if (raw) {
          const pids = JSON.parse(raw) as { root?: number; descendant?: number };
          if (pids.root) tracked.add(pids.root);
          if (pids.descendant) tracked.add(pids.descendant);
        }
        for (const pid of tracked) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Already reaped by the production cleanup path.
          }
        }
      }
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
