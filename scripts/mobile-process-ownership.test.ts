import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as processOwnership from "./mobile-process-ownership.ts";
import {
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

async function spawned(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function waitForFile(path: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
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

async function waitForOwnerStatus(
  ownerPath: string,
  status: ProcessOwner["status"],
) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (readProcessOwner(ownerPath)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`owner ${ownerPath} never reached ${status}`);
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
      processToken: "linux:boot-uuid:4242:987654",
    },
  );
});

test("Linux birth identity includes PID instead of assuming start ticks are unique", () => {
  const fields = [
    "S", "11", "22", "33", "4", "5", "6", "7", "8", "9",
    "10", "11", "12", "13", "14", "15", "16", "17", "18", "987654",
  ];
  const first = parseLinuxProcessInfo(`4242 (worker) ${fields.join(" ")}`, "boot-uuid");
  const second = parseLinuxProcessInfo(`4243 (worker) ${fields.join(" ")}`, "boot-uuid");
  assert.notDeepEqual(
    { pid: first.pid, processToken: first.processToken },
    { pid: second.pid, processToken: second.processToken },
  );
});

test("Linux process-table scanning skips unrelated kernel entries with zero group identity", () => {
  const parseForScan = (
    processOwnership as typeof processOwnership & {
      parseLinuxProcessInfoForScan?: (stat: string, bootId: string) => ProcessInfo | null;
    }
  ).parseLinuxProcessInfoForScan;
  assert.equal(typeof parseForScan, "function");
  const fields = [
    "S", "0", "0", "0", "4", "5", "6", "7", "8", "9",
    "10", "11", "12", "13", "14", "15", "16", "17", "18", "987654",
  ];
  assert.equal(parseForScan!(`2 (kthreadd) ${fields.join(" ")}`, "boot-uuid"), null);
  const zombieFields = [...fields];
  zombieFields[0] = "Z";
  zombieFields[2] = "22";
  zombieFields[3] = "33";
  assert.equal(
    parseForScan!(`4242 (exited child) ${zombieFields.join(" ")}`, "boot-uuid"),
    null,
    "zombies are already dead and must not keep cleanup pending",
  );
  assert.throws(
    () => parseLinuxProcessInfo(`2 (kthreadd) ${fields.join(" ")}`, "boot-uuid"),
    /missing identity fields/,
    "strict validation still rejects zero group/session identities",
  );
});

test("launch persists a live supervisor anchor and its backend child atomically", async () => {
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
    assert.equal(owner.version, 3);
    assert.equal(owner.status, "running");
    assert.notEqual(owner.supervisor.pid, owner.child?.pid);
    assert.equal(owner.supervisor.pid, owner.supervisor.processGroupId);
    assert.equal(owner.supervisor.pid, owner.supervisor.sessionId);
    assert.equal(owner.child?.processGroupId, owner.supervisor.processGroupId);
    assert.equal(owner.child?.sessionId, owner.supervisor.sessionId);
    assert.equal(owner.backendUrl, "http://[::1]:3007");
    assert.match(owner.supervisor.processToken, /^(?:linux:[^:]+:\d+:\d+|macos:\d+:\d+:\d+)$/);
    assert.equal((await stopOwnedProcessTree(ownerPath)).kind, "stopped");
    await waitForExit(owner.supervisor.pid);
    await waitForExit(owner.child!.pid);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a rootless reused session and process group never authorizes signaling a foreign child", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-rootless-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify({
    version: 3,
    status: "running",
    bootId: "boot-a",
    backendUrl: "http://127.0.0.1:3007",
    supervisor: {
      pid: 700,
      parentPid: 1,
      processGroupId: 700,
      sessionId: 700,
      processToken: "linux:boot-a:700:100",
    },
    child: {
      pid: 701,
      parentPid: 700,
      processGroupId: 700,
      sessionId: 700,
      processToken: "linux:boot-a:701:101",
    },
  }));
  const signals: Array<[number, NodeJS.Signals]> = [];
  try {
    const result = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => [{
        pid: 900,
        parentPid: 1,
        processGroupId: 700,
        sessionId: 700,
        processToken: "linux:boot-a:900:999",
      }],
      signalProcess: (pid: number, signal: NodeJS.Signals) => {
        signals.push([pid, signal]);
      },
      sleep: async () => undefined,
    } as never);
    assert.equal(result.kind, "identity-mismatch");
    assert.deepEqual(signals, []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stubborn backend escalation waits for readiness and drains the supervised group", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-stubborn-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  let owner: ProcessOwner | null = null;
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
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.child);
    const stopped = await stopOwnedProcessTree(ownerPath, { termWaitMs: 80, killWaitMs: 1000 });
    assert.equal(stopped.kind, "stopped");
    await waitForExit(owner.child.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner?.status !== "stopped") {
      try {
        process.kill(-owner!.supervisor.pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supervisor drains and retires itself when the backend exits on its own", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-natural-exit-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  let owner: ProcessOwner | null = null;
  try {
    const result = await launchOwnedProcess({
      ownerPath,
      backendUrl: "http://127.0.0.1:3007",
      cwd: fixture,
      command: process.execPath,
      args: [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready"); setTimeout(() => process.exit(0), 200)`,
      ],
      logPath: join(fixture, "next.log"),
      env: process.env,
    });
    assert.equal(result.kind, "launched");
    await waitForFile(readyPath);
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.child);
    await waitForOwnerStatus(ownerPath, "stopped");
    await waitForExit(owner.child.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner) {
      try {
        process.kill(-owner.supervisor.pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supervisor keeps draining descendants forked while the recorded child exits", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-late-fork-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  const lateReadyPath = join(fixture, "late-ready");
  const latePidPath = join(fixture, "late-pid");
  let owner: ProcessOwner | null = null;
  try {
    const backend = `
const { existsSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
writeFileSync(${JSON.stringify(readyPath)}, "ready");
process.on("SIGTERM", () => {
  const late = spawn("/bin/sh", ["-c", ${JSON.stringify(
    `trap '' TERM; echo ready > ${lateReadyPath}; while :; do sleep 1; done`,
  )}], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(latePidPath)}, String(late.pid));
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 1000;
  while (!existsSync(${JSON.stringify(lateReadyPath)}) && Date.now() < deadline) {
    Atomics.wait(wait, 0, 0, 10);
  }
  process.exit(0);
});
setInterval(() => {}, 1000);
`;
    const result = await launchOwnedProcess({
      ownerPath,
      backendUrl: "http://127.0.0.1:3007",
      cwd: fixture,
      command: process.execPath,
      args: ["-e", backend],
      logPath: join(fixture, "next.log"),
      env: process.env,
    });
    assert.equal(result.kind, "launched");
    await waitForFile(readyPath);
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.child);
    const stopped = await stopOwnedProcessTree(ownerPath, {
      termWaitMs: 120,
      killWaitMs: 1000,
    });
    assert.equal(stopped.kind, "stopped");
    await waitForFile(latePidPath);
    await waitForExit(Number(readFileSync(latePidPath, "utf8")));
    await waitForExit(owner.child.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner) {
      try {
        process.kill(-owner.supervisor.pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

async function runSupervisorFailure(stage: "boot" | "identity" | "persistence" | "cleanup") {
  const startedAt = Date.now();
  const fixture = mkdtempSync(join(scriptsDir, `.mobile-process-${stage}-`));
  const resultPath = join(fixture, "result.json");
  const ownerPath = join(fixture, "next.owner.json");
  const harnessPath = join(fixture, "harness.mjs");
  const moduleUrl = new URL("./mobile-process-ownership.ts", import.meta.url).href;
  writeFileSync(harnessPath, `
import { writeFileSync } from "node:fs";
import {
  kernelProcessIdentity,
  scanProcessTable,
  superviseOwnedBackend,
} from ${JSON.stringify(moduleUrl)};
let identityCalls = 0;
const result = await superviseOwnedBackend({
  ownerPath: ${JSON.stringify(ownerPath)},
  backendUrl: "http://127.0.0.1:3007",
  cwd: ${JSON.stringify(fixture)},
  command: process.execPath,
  args: ["-e", "setInterval(() => {}, 1000)"],
  logPath: ${JSON.stringify(join(fixture, "next.log"))},
  env: process.env,
}, {
  ${stage === "boot" ? 'currentBootId: async () => { throw new Error("boot unavailable"); },' : ""}
  ${stage === "identity" ? `processInfo: async (pid) => {
    identityCalls += 1;
    if (identityCalls === 1) return kernelProcessIdentity(pid);
    throw new Error("child identity unavailable");
  },` : ""}
  ${stage === "persistence" ? 'writeOwner: () => { throw new Error("disk full"); },' : ""}
  ${stage === "cleanup" ? `writeOwner: (() => {
    let writes = 0;
    return (path, owner) => {
      writes += 1;
      if (writes === 1) throw new Error("disk full");
      writeFileSync(path, JSON.stringify(owner));
    };
  })(),` : ""}
  scanProcessTable: async () => {
    const table = await scanProcessTable();
    writeFileSync(${JSON.stringify(join(fixture, "scan.log"))}, JSON.stringify(table.filter((entry) => entry.processGroupId === process.pid)) + "\\n", { flag: "a" });
    return table;
  },
  signalProcess: (pid, signal) => {
    writeFileSync(${JSON.stringify(join(fixture, "signal.log"))}, JSON.stringify({ pid, signal }) + "\\n", { flag: "a" });
    ${stage === "cleanup" ? "return;" : ""}
    process.kill(pid, signal);
  },
});
writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
if (result.kind !== "state-failed-cleanup-failed") process.exit(0);
`);
  const supervisor = spawn(process.execPath, [
    "--experimental-strip-types",
    harnessPath,
  ], {
    cwd: fixture,
    detached: true,
    stdio: "ignore",
  });
  await spawned(supervisor);
  supervisor.unref();
  await waitForFile(resultPath, 7000);
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  return { fixture, result, supervisor, elapsedMs: Date.now() - startedAt };
}

test("failed post-spawn cleanup persists an anchored diagnostic and returns promptly", async () => {
  const { fixture, result, supervisor, elapsedMs } = await runSupervisorFailure("cleanup");
  try {
    assert.ok(elapsedMs < 6000, `diagnostic result took ${elapsedMs}ms`);
    assert.equal(result.kind, "state-failed-cleanup-failed");
    const diagnostic = readProcessOwner(join(fixture, "next.owner.json"));
    assert.equal(diagnostic?.status, "diagnostic");
    assert.equal(diagnostic?.supervisor.pid, supervisor.pid);
    assert.doesNotThrow(() => process.kill(supervisor.pid!, 0));
  } finally {
    try {
      process.kill(-supervisor.pid!, "SIGKILL");
    } catch {}
    rmSync(fixture, { recursive: true, force: true });
  }
});

for (const stage of ["boot", "identity", "persistence"] as const) {
  test(`post-spawn ${stage} failure cleans the exact real child and returns promptly`, async () => {
    const { fixture, result, supervisor, elapsedMs } = await runSupervisorFailure(stage);
    try {
      assert.ok(elapsedMs < 6000, `cleanup result took ${elapsedMs}ms`);
      const detail = {
        result,
        scans: existsSync(join(fixture, "scan.log"))
          ? readFileSync(join(fixture, "scan.log"), "utf8")
          : "",
        signals: existsSync(join(fixture, "signal.log"))
          ? readFileSync(join(fixture, "signal.log"), "utf8")
          : "",
      };
      assert.equal(result.kind, "state-failed-cleaned", JSON.stringify(detail));
      assert.ok(result.owner?.childPid, "cleanup result retains the exact spawned child identity");
      await waitForExit(result.owner.childPid);
      await waitForExit(supervisor.pid!);
    } finally {
      try {
        process.kill(-supervisor.pid!, "SIGKILL");
      } catch {}
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
