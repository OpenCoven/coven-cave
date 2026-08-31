import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  kernelProcessToken,
  parseLinuxProcessStartTicks,
  readProcessOwner,
  recordProcessOwner,
  stopOwnedProcessTree,
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

async function waitForExit(pid: number, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
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
    const pair = starts
      .map((start, index) => ({ start, index }))
      .find(({ start, index }) => starts.indexOf(start) !== index);
    assert.ok(pair, "test processes must overlap the same ps lstart second");
    const first = starts.indexOf(pair.start);
    const second = pair.index;
    assert.notEqual(
      await kernelProcessToken(children[first]!.pid!),
      await kernelProcessToken(children[second]!.pid!),
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
});

test("Linux start ticks survive spaces and parentheses in the process command", () => {
  const fieldsThroughStartTime = [
    "S", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "10", "11", "12", "13", "14", "15", "16", "17", "18", "987654",
  ];
  assert.equal(
    parseLinuxProcessStartTicks(`4242 (worker (mobile cave)) ${fieldsThroughStartTime.join(" ")}`),
    "987654",
  );
});

test("process owner state atomically persists the exact backend and kernel token", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-record-"));
  const ownerPath = join(fixture, "next.owner.json");
  const child = sleeper();
  try {
    await spawned(child);
    await recordProcessOwner(ownerPath, child.pid!, "http://[::1]:3007");
    const owner = readProcessOwner(ownerPath);
    assert.equal(owner?.pid, child.pid);
    assert.equal(owner?.backendUrl, "http://[::1]:3007");
    assert.equal(owner?.processToken, await kernelProcessToken(child.pid!));
    assert.equal(statSync(ownerPath).mode & 0o777, 0o600);
    assert.equal(
      existsSync(join(fixture, "next.owner.json.partial")),
      false,
      "the canonical state is installed by rename, never exposed partially",
    );
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a planted foreign process token is never signaled", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-foreign-"));
  const ownerPath = join(fixture, "next.owner.json");
  const child = sleeper();
  try {
    await spawned(child);
    writeFileSync(ownerPath, JSON.stringify({
      version: 1,
      pid: child.pid,
      processToken: "foreign-token",
      backendUrl: "http://127.0.0.1:3007",
    }));
    chmodSync(ownerPath, 0o600);
    const result = await stopOwnedProcessTree(ownerPath, { termWaitMs: 50, killWaitMs: 50 });
    assert.equal(result.kind, "identity-mismatch");
    assert.doesNotThrow(() => process.kill(child.pid!, 0));
    assert.equal(existsSync(ownerPath), true);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a stubborn owned process is escalated only while its token still matches", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-stubborn-"));
  const ownerPath = join(fixture, "next.owner.json");
  const child = sleeper('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)');
  try {
    await spawned(child);
    await recordProcessOwner(ownerPath, child.pid!, "http://127.0.0.1:3007");
    const result = await stopOwnedProcessTree(ownerPath, { termWaitMs: 80, killWaitMs: 1000 });
    assert.equal(result.kind, "stopped");
    assert.equal(result.escalated, true);
    await waitForExit(child.pid!);
    assert.equal(readProcessOwner(ownerPath)?.stopped, true);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("owned child processes terminate with their recorded root", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-tree-"));
  const ownerPath = join(fixture, "next.owner.json");
  const childPidPath = join(fixture, "child.pid");
  const root = sleeper(`
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
    setInterval(() => {}, 1000);
  `);
  try {
    await spawned(root);
    const deadline = Date.now() + 2000;
    while (!existsSync(childPidPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    await recordProcessOwner(ownerPath, root.pid!, "http://127.0.0.1:3007");
    const result = await stopOwnedProcessTree(ownerPath, { termWaitMs: 500, killWaitMs: 1000 });
    assert.equal(result.kind, "stopped");
    await Promise.all([waitForExit(root.pid!), waitForExit(childPid)]);
  } finally {
    if (root.exitCode === null) root.kill("SIGKILL");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a stubborn child is killed after its owned root exits on TERM", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-stubborn-child-"));
  const ownerPath = join(fixture, "next.owner.json");
  const childPidPath = join(fixture, "child.pid");
  const root = sleeper(`
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, [
      "-e",
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
    ], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
    setInterval(() => {}, 1000);
  `);
  try {
    await spawned(root);
    const deadline = Date.now() + 2000;
    while (!existsSync(childPidPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    await recordProcessOwner(ownerPath, root.pid!, "http://127.0.0.1:3007");
    const result = await stopOwnedProcessTree(ownerPath, { termWaitMs: 80, killWaitMs: 1000 });
    assert.equal(result.kind, "stopped");
    assert.equal(result.escalated, true);
    await waitForExit(childPid);
  } finally {
    if (root.exitCode === null) root.kill("SIGKILL");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("signal failures retain owner state for a safe retry", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-failure-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify({
    version: 1,
    pid: 4242,
    processToken: "linux:12345",
    backendUrl: "http://127.0.0.1:3007",
  }));
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      tokenForPid: async () => "linux:12345",
      descendants: async () => [],
      signal: () => {
        const error = new Error("operation not permitted") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
      sleep: async () => undefined,
      termWaitMs: 1,
      killWaitMs: 1,
    });
    assert.equal(result.kind, "signal-failed");
    assert.equal(existsSync(ownerPath), true);
    assert.equal(readProcessOwner(ownerPath)?.stopped, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a process that survives TERM and KILL retains owner state", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-owner-nonexit-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify({
    version: 1,
    pid: 4242,
    processToken: "linux:12345",
    backendUrl: "http://127.0.0.1:3007",
  }));
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      tokenForPid: async () => "linux:12345",
      descendants: async () => [],
      signal: () => undefined,
      sleep: async () => undefined,
      termWaitMs: 1,
      killWaitMs: 1,
    });
    assert.equal(result.kind, "still-running");
    assert.equal(existsSync(ownerPath), true);
    assert.equal(readProcessOwner(ownerPath)?.stopped, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
