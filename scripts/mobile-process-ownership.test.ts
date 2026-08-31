import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  kernelProcessToken,
  launchOwnedProcess,
  parseLinuxProcessInfo,
  readProcessOwner,
  stopOwnedProcessTree,
  type ProcessInfo,
  type ProcessOwner,
} from "./mobile-process-ownership.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const identityBinary = join(scriptsDir, `.mobile-process-identity-test-${process.pid}`);
process.env.COVEN_CAVE_PROCESS_IDENTITY_BIN = identityBinary;
test.after(() => rmSync(identityBinary, { force: true }));

function sleeper(source = "setInterval(() => {}, 1000)") {
  return spawn(process.execPath, ["-e", source], { stdio: "ignore" });
}

async function spawned(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 3000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(existsSync(path), true, `timed out waiting for ${path}`);
}

async function waitForExit(pid: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
  }
  assert.fail(`pid ${pid} remained alive`);
}

test("Linux process identity atomically includes boot, ancestry, group, session, and start ticks", () => {
  const fields = [
    "S", "11", "22", "33", "4", "5", "6", "7", "8", "9",
    "10", "11", "12", "13", "14", "15", "16", "17", "18", "987654",
  ];
  assert.deepEqual(
    parseLinuxProcessInfo(`4242 (worker (mobile cave)) ${fields.join(" ")}`, "boot-uuid"),
    {
      pid: 4242,
      parentPid: 11,
      processGroupId: 22,
      sessionId: 33,
      processToken: "linux:boot-uuid:987654",
    },
  );
});

test("kernel tokens distinguish processes born in the same wall-clock second", async () => {
  const children = Array.from({ length: 4 }, () => sleeper());
  try {
    await Promise.all(children.map(spawned));
    const starts = children.map((child) =>
      spawnSync("ps", ["-p", String(child.pid), "-o", "lstart="], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      }).stdout.trim()
    );
    const duplicate = starts.find((start, index) => starts.indexOf(start) !== index);
    assert.ok(duplicate, "test processes must overlap the same ps lstart second");
    const indexes = starts
      .map((start, index) => ({ start, index }))
      .filter(({ start }) => start === duplicate)
      .map(({ index }) => index);
    assert.notEqual(
      await kernelProcessToken(children[indexes[0]!]!.pid!),
      await kernelProcessToken(children[indexes[1]!]!.pid!),
    );
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("launch creates and persists a dedicated process group and session", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-launch-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  try {
    const result = await launchOwnedProcess({
      ownerPath,
      backendUrl: "http://[::1]:3007",
      cwd: fixture,
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready"); setInterval(() => {}, 1000)`],
      logPath: join(fixture, "next.log"),
      env: process.env,
    });
    assert.equal(result.kind, "launched");
    await waitForFile(readyPath);
    const owner = readProcessOwner(ownerPath)!;
    assert.equal(owner.pid, owner.processGroupId);
    assert.equal(owner.pid, owner.sessionId);
    assert.equal(owner.backendUrl, "http://[::1]:3007");
    assert.match(owner.processToken, /^(?:linux:[^:]+:\d+|macos:\d+:\d+)$/);
    assert.equal((await stopOwnedProcessTree(ownerPath)).kind, "stopped");
    await waitForExit(owner.pid);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function owner(): ProcessOwner {
  return {
    version: 2,
    pid: 700,
    processToken: "linux:boot-a:100",
    processGroupId: 700,
    sessionId: 700,
    bootId: "boot-a",
    backendUrl: "http://127.0.0.1:3007",
  };
}

function info(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid: 700,
    parentPid: 1,
    processGroupId: 700,
    sessionId: 700,
    processToken: "linux:boot-a:100",
    ...overrides,
  };
}

test("a PID reused between scans is never blessed or signaled", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-reuse-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify(owner()));
  const signals: NodeJS.Signals[] = [];
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => [
        info({
          processToken: "linux:boot-a:999",
          processGroupId: 999,
          sessionId: 999,
        }),
      ],
      signalGroup: (_group, signal) => signals.push(signal),
      sleep: async () => undefined,
    });
    assert.equal(result.kind, "stopped");
    assert.deepEqual(signals, [], "the replacement PID is outside the persisted dedicated group");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a replacement root inside the persisted group fails closed", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-reuse-group-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify(owner()));
  let signaled = false;
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => [info({ processToken: "linux:boot-a:999" })],
      signalGroup: () => {
        signaled = true;
      },
      sleep: async () => undefined,
    });
    assert.equal(result.kind, "identity-mismatch");
    assert.equal(signaled, false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("late forks are continuously rescanned after the root exits", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-late-fork-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify(owner()));
  const signals: NodeJS.Signals[] = [];
  let scans = 0;
  let killed = false;
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => {
        scans += 1;
        if (scans === 1) return [info()];
        if (killed) return [];
        const pid = 700 + scans;
        return [info({
          pid,
          parentPid: pid - 1,
          processToken: `linux:boot-a:${100 + scans}`,
        })];
      },
      signalGroup: (_group, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") killed = true;
      },
      sleep: async () => undefined,
      termWaitMs: 1,
      killWaitMs: 20,
    });
    assert.equal(result.kind, "stopped");
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.ok(scans >= 4, "the owned group is scanned through root exit and late forks");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("one empty process-table scan cannot hide a late owned group member", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-scan-gap-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify(owner()));
  let scans = 0;
  let terminated = false;
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => {
        scans += 1;
        if (scans === 1 || terminated) return [];
        return [info({ pid: 701, parentPid: 700, processToken: "linux:boot-a:101" })];
      },
      signalGroup: (_group, signal) => {
        if (signal === "SIGTERM") terminated = true;
      },
      sleep: async () => undefined,
    });
    assert.equal(result.kind, "stopped");
    assert.equal(terminated, true, "a member visible after a scan gap must be terminated");
    assert.ok(scans >= 4, "shutdown requires two consecutive empty snapshots");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stubborn escalation waits until the SIGTERM handler is installed", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-stubborn-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  try {
    const result = await launchOwnedProcess({
      ownerPath,
      backendUrl: "http://127.0.0.1:3007",
      cwd: fixture,
      command: process.execPath,
      args: ["-e", `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready"); setInterval(() => {}, 1000)`],
      logPath: join(fixture, "next.log"),
      env: process.env,
    });
    assert.equal(result.kind, "launched");
    await waitForFile(readyPath);
    const stopped = await stopOwnedProcessTree(ownerPath, { termWaitMs: 80, killWaitMs: 1000 });
    assert.equal(stopped.kind, "stopped");
    assert.equal(stopped.escalated, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("owner persistence failure terminates the exact newly launched group", async () => {
  let signaled = false;
  const result = await launchOwnedProcess({
    ownerPath: "/state/next.owner.json",
    backendUrl: "http://127.0.0.1:3007",
    cwd: "/repo",
    command: "pnpm",
    args: ["dev"],
    logPath: "/state/next.log",
    env: { NODE_ENV: "test" },
  }, {
    spawnDetached: () => ({ pid: 700 }),
    processInfo: async () => info(),
    currentBootId: async () => "boot-a",
    writeOwner: () => {
      throw new Error("disk full");
    },
    stopOwner: async () => {
      signaled = true;
      return { kind: "stopped", escalated: false };
    },
  });
  assert.equal(result.kind, "state-failed-cleaned");
  assert.equal(signaled, true);
});

test("failed launch cleanup retains diagnostic owner state", async () => {
  const writes: ProcessOwner[] = [];
  const result = await launchOwnedProcess({
    ownerPath: "/state/next.owner.json",
    backendUrl: "http://127.0.0.1:3007",
    cwd: "/repo",
    command: "pnpm",
    args: ["dev"],
    logPath: "/state/next.log",
    env: { NODE_ENV: "test" },
  }, {
    spawnDetached: () => ({ pid: 700 }),
    processInfo: async () => info(),
    currentBootId: async () => "boot-a",
    writeOwner: () => {
      throw new Error("initial write failed");
    },
    writeDiagnostic: (_path, value) => {
      writes.push(value);
    },
    stopOwner: async () => ({ kind: "still-running" }),
  });
  assert.equal(result.kind, "state-failed-cleanup-failed");
  assert.equal(writes[0]?.diagnostic, "launch-state-persistence-failed");
});
