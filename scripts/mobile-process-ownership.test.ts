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
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
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

test("launch persists independent supervisor and backend-root anchors atomically", async () => {
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
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    assert.equal(owner.version, 4);
    assert.equal(owner.status, "running");
    assert.notEqual(owner.supervisor.pid, owner.backendRoot?.pid);
    assert.equal(owner.supervisor.pid, owner.supervisor.processGroupId);
    assert.equal(owner.supervisor.pid, owner.supervisor.sessionId);
    assert.equal(owner.backendRoot?.pid, owner.backendRoot?.processGroupId);
    assert.equal(owner.backendRoot?.pid, owner.backendRoot?.sessionId);
    assert.equal(owner.backendUrl, "http://[::1]:3007");
    assert.match(owner.supervisor.processToken, /^(?:linux:[^:]+:\d+:\d+|macos:\d+:\d+:\d+)$/);
    assert.match(owner.backendRoot.processToken, /^(?:linux:[^:]+:\d+:\d+|macos:\d+:\d+:\d+)$/);
    assert.equal((await stopOwnedProcessTree(ownerPath)).kind, "stopped");
    await waitForExit(owner.supervisor.pid);
    await waitForExit(owner.backendRoot.pid);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("backend-root anchor survives supervisor SIGKILL and drains the real backend tree", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-supervisor-crash-"));
  const ownerPath = join(fixture, "next.owner.json");
  const backendPidPath = join(fixture, "backend-pid");
  const childPidPath = join(fixture, "child-pid");
  let supervisorPid: number | null = null;
  let backendRootPid: number | null = null;
  let backendPid: number | null = null;
  let childPid: number | null = null;
  try {
    const backend = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(backendPidPath)}, String(process.pid));
writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
setInterval(() => {}, 1000);
`;
    const launched = await launchOwnedProcess({
      ownerPath,
      backendUrl: "http://127.0.0.1:3007",
      cwd: fixture,
      command: process.execPath,
      args: ["-e", backend],
      logPath: join(fixture, "next.log"),
      env: process.env,
    });
    assert.equal(launched.kind, "launched");
    await waitForFile(childPidPath);
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    supervisorPid = owner.supervisor.pid;
    backendRootPid = owner.backendRoot?.pid;
    backendPid = Number(readFileSync(backendPidPath, "utf8"));
    childPid = Number(readFileSync(childPidPath, "utf8"));

    process.kill(supervisorPid!, "SIGKILL");
    await waitForExit(supervisorPid!);

    const stopped = await stopOwnedProcessTree(ownerPath);
    assert.equal(stopped.kind, "stopped");
    await waitForExit(backendRootPid!);
    await waitForExit(backendPid!);
    await waitForExit(childPid!);
    assert.equal(readProcessOwner(ownerPath)?.status, "stopped");
  } finally {
    for (const pid of [childPid, backendPid, backendRootPid, supervisorPid]) {
      if (!pid) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supervisor crash between backend-root spawn and promotion leaves no orphan", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-promotion-crash-"));
  const ownerPath = join(fixture, "next.owner.json");
  const harnessPath = join(fixture, "harness.mjs");
  const moduleUrl = new URL("./mobile-process-ownership.ts", import.meta.url).href;
  writeFileSync(harnessPath, `
import { superviseOwnedBackend } from ${JSON.stringify(moduleUrl)};
await superviseOwnedBackend({
  ownerPath: ${JSON.stringify(ownerPath)},
  backendUrl: "http://127.0.0.1:3007",
  cwd: ${JSON.stringify(fixture)},
  command: process.execPath,
  args: ["-e", "setInterval(() => {}, 1000)"],
  logPath: ${JSON.stringify(join(fixture, "next.log"))},
  env: process.env,
}, {
  launchTimeoutMs: 5000,
  beforePromotion: async () => await new Promise(() => {}),
});
`);
  const supervisor = spawn(process.execPath, ["--experimental-strip-types", harnessPath], {
    cwd: fixture,
    detached: true,
    stdio: "ignore",
  });
  await spawned(supervisor);
  supervisor.unref();
  let backendRootPid: number | null = null;
  try {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const owner = readProcessOwner(ownerPath);
      if (owner?.status === "launching" && owner.backendRoot) {
        backendRootPid = owner.backendRoot.pid;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(backendRootPid, "backend-root launching anchor was persisted");
    process.kill(supervisor.pid!, "SIGKILL");
    await waitForExit(supervisor.pid!);
    await waitForOwnerStatus(ownerPath, "stopped");
    await waitForExit(backendRootPid);
    assert.equal((await stopOwnedProcessTree(ownerPath)).kind, "stopped");
  } finally {
    for (const pid of [backendRootPid, supervisor.pid]) {
      if (!pid) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supervisor retains its anchor and diagnostic state when backend-root cleanup cannot finish", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-supervisor-cleanup-failure-"));
  const ownerPath = join(fixture, "next.owner.json");
  const launched = await launchOwnedProcess({
    ownerPath,
    backendUrl: "http://127.0.0.1:3007",
    cwd: fixture,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    logPath: join(fixture, "next.log"),
    env: process.env,
  });
  assert.equal(launched.kind, "launched");
  const owner = readProcessOwner(ownerPath);
  assert.ok(owner?.backendRoot);
  try {
    process.kill(owner.backendRoot.pid, "SIGSTOP");
    process.kill(owner.supervisor.pid, "SIGTERM");
    await waitForOwnerStatus(ownerPath, "diagnostic", 6000);
    assert.doesNotThrow(
      () => process.kill(owner.supervisor.pid, 0),
      "failed cleanup must retain the continuously verified supervisor anchor",
    );
    assert.match(readProcessOwner(ownerPath)?.error ?? "", /still-running/);
  } finally {
    try {
      process.kill(owner.backendRoot.pid, "SIGCONT");
    } catch {}
    await stopOwnedProcessTree(ownerPath).catch(() => undefined);
    for (const pid of [owner.backendRoot.pid, owner.supervisor.pid]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("backend-root disappearance without a stopped acknowledgement fails closed", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-unacknowledged-root-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify({
    version: 4,
    status: "running",
    bootId: "boot-a",
    backendUrl: "http://127.0.0.1:3007",
    launchDeadlineMs: Date.now() + 1000,
    supervisor: {
      pid: 600,
      parentPid: 1,
      processGroupId: 600,
      sessionId: 600,
      processToken: "linux:boot-a:600:100",
    },
    backendRoot: {
      pid: 700,
      parentPid: 1,
      processGroupId: 700,
      sessionId: 700,
      processToken: "linux:boot-a:700:101",
    },
  }));
  let rootAlive = true;
  let supervisorAlive = true;
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const table = () => [
    ...(supervisorAlive ? [{
      pid: 600,
      parentPid: 1,
      processGroupId: 600,
      sessionId: 600,
      processToken: "linux:boot-a:600:100",
    }] : []),
    ...(rootAlive ? [{
      pid: 700,
      parentPid: 1,
      processGroupId: 700,
      sessionId: 700,
      processToken: "linux:boot-a:700:101",
    }] : []),
  ];
  try {
    const stopped = await stopOwnedProcessTree(ownerPath, {
      currentBootId: async () => "boot-a",
      scanProcessTable: async () => table(),
      signalProcess: (pid, signal) => {
        signals.push({ pid, signal });
        if (pid === 700) rootAlive = false;
        if (pid === 600) supervisorAlive = false;
      },
      sleep: async () => {},
      termWaitMs: 0,
      killWaitMs: 0,
    });
    assert.equal(stopped.kind, "identity-mismatch");
    assert.deepEqual(signals, [{ pid: 700, signal: "SIGTERM" }]);
    assert.equal(readProcessOwner(ownerPath)?.status, "running");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a rootless reused session and process group never authorizes signaling a foreign child", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-rootless-"));
  const ownerPath = join(fixture, "next.owner.json");
  writeFileSync(ownerPath, JSON.stringify({
    version: 4,
    status: "running",
    bootId: "boot-a",
    backendUrl: "http://127.0.0.1:3007",
    launchDeadlineMs: Date.now() - 1,
    supervisor: {
      pid: 700,
      parentPid: 1,
      processGroupId: 700,
      sessionId: 700,
      processToken: "linux:boot-a:700:100",
    },
    backendRoot: {
      pid: 701,
      parentPid: 1,
      processGroupId: 701,
      sessionId: 701,
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
        processGroupId: 701,
        sessionId: 701,
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
  let backendPid: number | null = null;
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
    backendPid = result.pid;
    await waitForFile(readyPath);
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.backendRoot);
    const stopped = await stopOwnedProcessTree(ownerPath, { termWaitMs: 80, killWaitMs: 1000 });
    assert.equal(stopped.kind, "stopped");
    await waitForExit(backendPid);
    await waitForExit(owner.backendRoot.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner?.status !== "stopped") {
      for (const pid of [backendPid, owner?.backendRoot?.pid, owner?.supervisor.pid]) {
        if (!pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supervisor drains and retires itself when the backend exits on its own", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-process-natural-exit-"));
  const ownerPath = join(fixture, "next.owner.json");
  const readyPath = join(fixture, "ready");
  let owner: ProcessOwner | null = null;
  let backendPid: number | null = null;
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
    backendPid = result.pid;
    await waitForFile(readyPath);
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.backendRoot);
    await waitForOwnerStatus(ownerPath, "stopped");
    await waitForExit(backendPid);
    await waitForExit(owner.backendRoot.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner) {
      for (const pid of [backendPid, owner.backendRoot?.pid, owner.supervisor.pid]) {
        if (!pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
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
  let backendPid: number | null = null;
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
    backendPid = result.pid;
    await waitForFile(readyPath);
    owner = readProcessOwner(ownerPath);
    assert.ok(owner?.backendRoot);
    const stopped = await stopOwnedProcessTree(ownerPath, {
      termWaitMs: 120,
      killWaitMs: 1000,
    });
    assert.equal(stopped.kind, "stopped");
    await waitForFile(latePidPath);
    await waitForExit(Number(readFileSync(latePidPath, "utf8")));
    await waitForExit(backendPid);
    await waitForExit(owner.backendRoot.pid);
    await waitForExit(owner.supervisor.pid);
  } finally {
    if (owner) {
      for (const pid of [backendPid, owner.backendRoot?.pid, owner.supervisor.pid]) {
        if (!pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});

async function runSupervisorFailure(
  stage: "boot" | "identity" | "persistence" | "cleanup" | "root-crash",
) {
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
  readProcessOwner,
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
  ${stage === "persistence" ? `writeOwner: (() => {
    let writes = 0;
    return (path, owner) => {
      writes += 1;
      if (writes === 2) throw new Error("disk full");
      writeFileSync(path, JSON.stringify(owner));
    };
  })(),` : ""}
  ${stage === "cleanup" ? `beforePromotion: async () => {
    const owner = readProcessOwner(${JSON.stringify(ownerPath)});
    if (!owner?.backendRoot) throw new Error("backend root missing");
    process.kill(owner.backendRoot.pid, "SIGSTOP");
    throw new Error("promotion failed");
  },` : ""}
  ${stage === "root-crash" ? `beforePromotion: async () => {
    const owner = readProcessOwner(${JSON.stringify(ownerPath)});
    if (!owner?.backendRoot) throw new Error("backend root missing");
    process.kill(owner.backendRoot.pid, "SIGKILL");
    throw new Error("backend root crashed");
  },` : ""}
  scanProcessTable: async () => {
    const table = await scanProcessTable();
    writeFileSync(${JSON.stringify(join(fixture, "scan.log"))}, JSON.stringify(table.filter((entry) => entry.processGroupId === process.pid)) + "\\n", { flag: "a" });
    return table;
  },
  signalProcess: (pid, signal) => {
    writeFileSync(${JSON.stringify(join(fixture, "signal.log"))}, JSON.stringify({ pid, signal }) + "\\n", { flag: "a" });
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
    assert.ok(diagnostic?.backendRoot);
    assert.doesNotThrow(() => process.kill(supervisor.pid!, 0));
  } finally {
    const diagnostic = readProcessOwner(join(fixture, "next.owner.json"));
    if (diagnostic?.backendRoot) {
      try {
        process.kill(diagnostic.backendRoot.pid, "SIGKILL");
      } catch {}
    }
    try {
      process.kill(supervisor.pid!, "SIGKILL");
    } catch {}
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a backend-root crash cannot be reported as successful setup cleanup", async () => {
  const { fixture, result, supervisor } = await runSupervisorFailure("root-crash");
  try {
    assert.equal(result.kind, "state-failed-cleanup-failed");
    const diagnostic = readProcessOwner(join(fixture, "next.owner.json"));
    assert.equal(diagnostic?.status, "diagnostic");
    assert.match(diagnostic?.error ?? "", /backend root crashed/);
    assert.doesNotThrow(() => process.kill(supervisor.pid!, 0));
  } finally {
    try {
      process.kill(supervisor.pid!, "SIGKILL");
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
      assert.ok(result.owner?.backendRoot, "cleanup result retains the exact backend-root identity");
      await waitForExit(result.owner.backendRoot.pid);
      await waitForExit(supervisor.pid!);
    } finally {
      if (result.owner?.backendRoot) {
        try {
          process.kill(result.owner.backendRoot.pid, "SIGKILL");
        } catch {}
      }
      try {
        process.kill(supervisor.pid!, "SIGKILL");
      } catch {}
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
