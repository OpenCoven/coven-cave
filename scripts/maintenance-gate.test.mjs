import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireMaintenanceGate,
  heartbeatMaintenanceGate,
  maintenanceGateRoot,
  maintenanceGateStatus,
  registerWriterIntent,
  releaseMaintenanceGate,
  releaseWriterIntent,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";

const moduleUrl = new URL("./maintenance-gate.mjs", import.meta.url);
const MAX_SAFE_TEST_OFFSET = 60 * 60_000;

function makeRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "cave-gate-"));
  execFileSync("git", ["init", "-q", repo]);
  return repo;
}

function intentFileForLease(lease) {
  const directory = path.join(lease.root, "intents");
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(directory, name);
    const state = JSON.parse(readFileSync(filePath, "utf8"));
    if (state.token === lease.token) return filePath;
  }
  assert.fail(`intent file not found for ${lease.writerId}`);
}

function expireGate(repo) {
  const filePath = path.join(maintenanceGateRoot(repo), "gate.json");
  const original = JSON.parse(readFileSync(filePath, "utf8"));
  const heartbeat = Date.now() - original.ttlMs - 1_000;
  writeFileSync(
    filePath,
    JSON.stringify({
      ...original,
      acquiredAt: new Date(heartbeat - 1).toISOString(),
      heartbeatAt: new Date(heartbeat).toISOString(),
    }),
  );
  return { filePath, original };
}

function expireIntent(lease) {
  const filePath = intentFileForLease(lease);
  const original = JSON.parse(readFileSync(filePath, "utf8"));
  const heartbeat = Date.now() - original.ttlMs - 1_000;
  writeFileSync(
    filePath,
    JSON.stringify({
      ...original,
      registeredAt: new Date(heartbeat - 1).toISOString(),
      heartbeatAt: new Date(heartbeat).toISOString(),
    }),
  );
  return { filePath, original };
}

async function waitUntil(predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function collectChild(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`child exited ${status}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim().split("\n").pop()));
    });
  });
}

function spawnPausedMutation({ mode, ready, proceed, payload }) {
  const worker = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import path from "node:path";
    const config = JSON.parse(process.env.CAVE_GATE_RACE_CONFIG);
    const pause = () => {
      fs.writeFileSync(config.ready, "ready");
      while (!fs.existsSync(config.proceed)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    };
    const originalRename = fs.renameSync;
    const originalRemove = fs.rmSync;
    fs.renameSync = (source, target) => {
      const targetIsGate = path.basename(target) === "gate.json";
      const targetIsIntent = path.basename(path.dirname(target)) === "intents";
      if (config.mode === "gate-heartbeat" && targetIsGate && source.endsWith(".tmp")) pause();
      if (config.mode === "intent-heartbeat" && targetIsIntent && source.endsWith(".tmp")) pause();
      return originalRename(source, target);
    };
    fs.rmSync = (target, options) => {
      if (config.mode === "intent-release" && path.basename(path.dirname(target)) === "intents") pause();
      return originalRemove(target, options);
    };
    syncBuiltinESMExports();
    const gate = await import(config.moduleUrl);
    const result = config.mode === "gate-heartbeat"
      ? gate.heartbeatMaintenanceGate(config.payload.handle)
      : config.mode === "intent-heartbeat"
        ? gate.heartbeatWriterIntent(config.payload.lease)
        : gate.releaseWriterIntent(config.payload.lease);
    console.log(JSON.stringify(result));
  `;
  return spawn(process.execPath, ["--input-type=module", "-e", worker], {
    env: {
      ...process.env,
      CAVE_GATE_RACE_CONFIG: JSON.stringify({
        mode,
        ready,
        proceed,
        payload,
        moduleUrl: moduleUrl.href,
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("writer-before-gate drains: acquisition waits for the live intent to release", () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "writer-a", repoDir: repo, purpose: "commit" });
  assert.equal(intent.ok, true);

  // A short quiesce window with the intent still live must time out and name it.
  const blocked = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 350 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "quiesce-timeout");
  assert.deepEqual(blocked.blockers, ["writer-a"]);
  // The failed drain must not leave a gate behind.
  assert.equal(maintenanceGateStatus(repo).gate, null, "a timed-out drain releases the gate file");

  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 1000 });
  assert.equal(acquired.ok, true, "acquisition succeeds once the writer released");
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("gate-before-writer rejects: no new intent may start under a gate, in any phase", () => {
  const repo = makeRepo();
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);

  const rejected = registerWriterIntent({ writerId: "late-writer", repoDir: repo });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "maintenance-gate-held");
  assert.deepEqual(maintenanceGateStatus(repo).liveIntents, [], "the rejected writer self-revoked its lease file");

  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  assert.equal(registerWriterIntent({ writerId: "late-writer", repoDir: repo }).ok, true, "writers flow again after release");
  rmSync(repo, { recursive: true, force: true });
});

test("malformed ownership fails closed everywhere — never silently reclaimed", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);
  writeFileSync(path.join(root, "gate.json"), "{not json");

  assert.equal(acquireMaintenanceGate({ ownerId: "second", repoDir: repo }).reason, "malformed-gate");
  assert.equal(acquireMaintenanceGate({ ownerId: "second", repoDir: repo, takeoverStale: true }).reason, "malformed-gate", "takeover never applies to malformed state");
  assert.equal(registerWriterIntent({ writerId: "w", repoDir: repo }).reason, "maintenance-gate-unreadable");
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "malformed-gate");
  assert.equal(releaseMaintenanceGate(acquired.handle).reason, "malformed-gate");

  // A malformed INTENT blocks acquisition the same way.
  rmSync(path.join(root, "gate.json"), { force: true });
  writeFileSync(path.join(root, "intents", "broken.json"), "{not json");
  const blockedByIntent = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 300 });
  assert.equal(blockedByIntent.reason, "malformed-intent");
  assert.deepEqual(blockedByIntent.files, ["broken.json"]);
  rmSync(repo, { recursive: true, force: true });
});

test("semantically malformed gate state fails closed", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);
  const gateFile = path.join(root, "gate.json");
  const onDisk = JSON.parse(readFileSync(gateFile, "utf8"));
  writeFileSync(gateFile, JSON.stringify({ ...onDisk, heartbeatAt: "not-a-date", ttlMs: "nan" }));

  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "malformed-gate");
  assert.equal(acquireMaintenanceGate({ ownerId: "second", repoDir: repo }).reason, "malformed-gate");
  assert.equal(registerWriterIntent({ writerId: "w", repoDir: repo }).reason, "maintenance-gate-unreadable");
  rmSync(repo, { recursive: true, force: true });
});

test("semantically malformed writer intent blocks acquisition", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  mkdirSync(path.join(root, "intents"), { recursive: true });
  writeFileSync(
    path.join(root, "intents", "broken.json"),
    JSON.stringify({
      writerId: "broken",
      token: "0123456789abcdef",
      registeredAt: new Date().toISOString(),
      heartbeatAt: "not-a-date",
      ttlMs: "nan",
      purpose: "",
      pid: process.pid,
    }),
  );

  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 100 });
  assert.equal(acquired.reason, "malformed-intent");
  assert.deepEqual(acquired.files, ["broken.json"]);
  rmSync(repo, { recursive: true, force: true });
});

test("an unreadable intent scan fails closed and releases the draining gate", async () => {
  const repo = makeRepo();
  const worker = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const originalReadDir = fs.readdirSync;
    fs.readdirSync = (target, options) => {
      if (path.basename(target) === "intents") {
        const error = new Error("injected unreadable intent directory");
        error.code = "EACCES";
        throw error;
      }
      return originalReadDir(target, options);
    };
    syncBuiltinESMExports();
    const gate = await import(${JSON.stringify(moduleUrl.href)});
    const result = gate.acquireMaintenanceGate({ ownerId: "curator", repoDir: process.argv[1] });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const acquired = await collectChild(child);
  assert.equal(acquired.reason, "intent-scan-failed");
  assert.equal(maintenanceGateStatus(repo).gate, null);
  rmSync(repo, { recursive: true, force: true });
});

test("a transiently incomplete mutation lock is treated as contention, not malformed state", async () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  mkdirSync(root, { recursive: true });
  const lockFile = path.join(root, "mutation.lock");
  writeFileSync(lockFile, "");
  const readyFile = path.join(repo, "lock-contender-ready");

  const worker = `
    import { writeFileSync } from "node:fs";
    import { registerWriterIntent } from ${JSON.stringify(moduleUrl.href)};
    writeFileSync(process.argv[2], "ready");
    const result = registerWriterIntent({ writerId: "waiting-writer", repoDir: process.argv[1] });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo, readyFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = collectChild(child);
  await waitUntil(() => existsSync(readyFile), "lock contender never started");
  await new Promise((resolve) => setTimeout(resolve, 50));
  writeFileSync(
    lockFile,
    JSON.stringify({
      token: "0123456789abcdef01234567",
      acquiredAt: new Date().toISOString(),
      pid: process.pid,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(lockFile);

  const registered = await result;
  assert.equal(registered.ok, true);
  assert.equal(releaseWriterIntent(registered.lease).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("caller-controlled time cannot force takeover or publish a future lease", () => {
  const repo = makeRepo();
  const acquired = acquireMaintenanceGate({ ownerId: "first", repoDir: repo });
  assert.equal(acquired.ok, true);
  const forced = acquireMaintenanceGate({
    ownerId: "second",
    repoDir: repo,
    takeoverStale: true,
    now: Date.now() + MAX_SAFE_TEST_OFFSET,
  });
  assert.equal(forced.reason, "gate-held");
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);

  const intent = registerWriterIntent({
    writerId: "writer",
    repoDir: repo,
    now: Date.now() + MAX_SAFE_TEST_OFFSET,
  });
  assert.equal(intent.ok, true);
  const intentState = JSON.parse(
    readFileSync(intentFileForLease(intent.lease), "utf8"),
  );
  assert.ok(Date.parse(intentState.heartbeatAt) <= Date.now());
  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("stale takeover fences out the previous owner's every capability", () => {
  const repo = makeRepo();
  const first = acquireMaintenanceGate({ ownerId: "first", repoDir: repo });
  assert.equal(first.ok, true);
  expireGate(repo);

  // Expired but well-formed: plain acquisition reports staleness...
  const stale = acquireMaintenanceGate({ ownerId: "second", repoDir: repo });
  assert.equal(stale.reason, "gate-stale");
  // ...and only an explicit takeover proceeds, bumping the generation.
  const second = acquireMaintenanceGate({ ownerId: "second", repoDir: repo, takeoverStale: true });
  assert.equal(second.ok, true);
  assert.ok(second.handle.generation > first.handle.generation, "takeover advances the fenced generation");

  assert.equal(verifyMaintenanceGateOwnership(first.handle).reason, "not-owner", "old owner cannot verify");
  assert.equal(heartbeatMaintenanceGate(first.handle).reason, "not-owner", "old owner cannot heartbeat");
  assert.equal(releaseMaintenanceGate(first.handle).reason, "not-owner", "old owner cannot release");
  assert.equal(verifyMaintenanceGateOwnership(second.handle).ok, true);
  assert.equal(releaseMaintenanceGate(second.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("owner capability holds through postconditions and dies on tampering, expiry, and release", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, ttlMs: 60_000 });
  assert.equal(acquired.ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);

  assert.equal(heartbeatMaintenanceGate(acquired.handle).ok, true);
  const gateFile = path.join(root, "gate.json");
  const heartbeated = JSON.parse(readFileSync(gateFile, "utf8"));
  writeFileSync(
    gateFile,
    JSON.stringify({
      ...heartbeated,
      heartbeatAt: new Date(Date.now() + MAX_SAFE_TEST_OFFSET).toISOString(),
    }),
  );
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "clock-regressed");
  assert.equal(maintenanceGateStatus(repo).gate.clockRegressed, true);
  assert.equal(
    heartbeatMaintenanceGate(acquired.handle).reason,
    "heartbeat-regressed",
  );
  writeFileSync(gateFile, JSON.stringify(heartbeated));
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);

  // External tampering with the token invalidates the capability.
  writeFileSync(gateFile, JSON.stringify({ ...heartbeated, token: "forged" }));
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "malformed-gate");

  writeFileSync(gateFile, JSON.stringify(heartbeated));
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);
  expireGate(repo);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "expired");

  writeFileSync(gateFile, JSON.stringify(heartbeated));
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "gate-missing");
  rmSync(repo, { recursive: true, force: true });
});

test("a fenced owner cannot overwrite a successful stale takeover", async () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const first = acquireMaintenanceGate({ ownerId: "first", repoDir: repo });
  assert.equal(first.ok, true);

  const ready = path.join(repo, "heartbeat-ready");
  const proceed = path.join(repo, "heartbeat-proceed");
  const child = spawnPausedMutation({
    mode: "gate-heartbeat",
    ready,
    proceed,
    payload: { handle: first.handle },
  });
  const childResult = collectChild(child);
  await waitUntil(() => existsSync(ready), "old owner never reached its final heartbeat mutation");
  expireGate(repo);

  const second = acquireMaintenanceGate({
    ownerId: "second",
    repoDir: repo,
    takeoverStale: true,
  });
  writeFileSync(proceed, "proceed");
  const heartbeat = await childResult;

  assert.equal(
    second.ok && heartbeat.ok,
    false,
    "takeover and the fenced owner's later pathname mutation must not both succeed",
  );
  const status = maintenanceGateStatus(repo);
  if (second.ok) {
    assert.equal(status.gate.ownerId, "second");
  } else if (heartbeat.ok) {
    assert.equal(status.gate.ownerId, "first");
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test("promotion rechecks intents after a concurrent writer heartbeat", async () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({
    writerId: "promotion-writer",
    repoDir: repo,
  });
  assert.equal(intent.ok, true);

  const acquireWorker = `
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const result = acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
      quiesceTimeoutMs: 5000,
    });
    console.log(JSON.stringify(result));
  `;
  const acquireChild = spawn(
    process.execPath,
    ["--input-type=module", "-e", acquireWorker, repo],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const acquiredResult = collectChild(acquireChild);
  await waitUntil(
    () => maintenanceGateStatus(repo).gate?.phase === "draining",
    "gate never entered draining phase",
    30_000,
  );

  const ready = path.join(repo, "intent-heartbeat-ready");
  const proceed = path.join(repo, "intent-heartbeat-proceed");
  const heartbeatChild = spawnPausedMutation({
    mode: "intent-heartbeat",
    ready,
    proceed,
    payload: { lease: intent.lease },
  });
  const heartbeatResult = collectChild(heartbeatChild);
  await waitUntil(() => existsSync(ready), "writer heartbeat never reached its final mutation");
  expireIntent(intent.lease);
  await new Promise((resolve) => setTimeout(resolve, 150));
  writeFileSync(proceed, "proceed");
  assert.equal((await heartbeatResult).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const duringRenewedWrite = maintenanceGateStatus(repo);
  assert.equal(duringRenewedWrite.gate?.phase, "draining");
  assert.deepEqual(duringRenewedWrite.liveIntents, ["promotion-writer"]);

  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  const acquired = await acquiredResult;
  assert.equal(acquired.ok, true);
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("deadline contention cleans up the exact owned draining gate", async () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "blocked-writer", repoDir: repo });
  assert.equal(intent.ok, true);
  const acquireWorker = `
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const result = acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
      quiesceTimeoutMs: 500,
    });
    console.log(JSON.stringify(result));
  `;
  const acquireChild = spawn(
    process.execPath,
    ["--input-type=module", "-e", acquireWorker, repo],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const acquiredResult = collectChild(acquireChild);
  await waitUntil(
    () => maintenanceGateStatus(repo).gate?.phase === "draining",
    "gate never entered draining phase",
    30_000,
  );

  const ready = path.join(repo, "deadline-heartbeat-ready");
  const proceed = path.join(repo, "deadline-heartbeat-proceed");
  const heartbeatChild = spawnPausedMutation({
    mode: "intent-heartbeat",
    ready,
    proceed,
    payload: { lease: intent.lease },
  });
  const heartbeatResult = collectChild(heartbeatChild);
  await waitUntil(() => existsSync(ready), "writer heartbeat never held the mutation lock");
  const releasePause = new Promise((resolve) => {
    setTimeout(() => {
      writeFileSync(proceed, "proceed");
      resolve();
    }, 1_500);
  });

  const acquired = await acquiredResult;
  await releasePause;
  assert.equal((await heartbeatResult).ok, true);
  assert.equal(acquired.reason, "quiesce-timeout");
  assert.equal(maintenanceGateStatus(repo).gate, null);
  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("clock regression during drain does not report timeout blockers", async () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "clock-writer", repoDir: repo });
  assert.equal(intent.ok, true);
  const worker = `
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const result = acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
      quiesceTimeoutMs: 5000,
    });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const acquiredResult = collectChild(child);
  await waitUntil(
    () => maintenanceGateStatus(repo).gate?.phase === "draining",
    "gate never entered draining phase",
    30_000,
  );

  const gateFile = path.join(maintenanceGateRoot(repo), "gate.json");
  const gate = JSON.parse(readFileSync(gateFile, "utf8"));
  writeFileSync(
    gateFile,
    JSON.stringify({
      ...gate,
      heartbeatAt: new Date(Date.now() + MAX_SAFE_TEST_OFFSET).toISOString(),
    }),
  );

  const acquired = await acquiredResult;
  assert.equal(acquired.reason, "clock-regressed");
  assert.equal(Object.hasOwn(acquired, "blockers"), false);
  assert.equal(maintenanceGateStatus(repo).gate, null);
  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("a gate is active when acquisition returns after a slow drain", async () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "slow-writer", repoDir: repo });
  assert.equal(intent.ok, true);
  const worker = `
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const result = acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
      ttlMs: 500,
      quiesceTimeoutMs: 5000,
    });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const acquiredResult = collectChild(child);
  await waitUntil(
    () => maintenanceGateStatus(repo).gate?.phase === "draining",
    "gate never entered draining phase",
    30_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(
    maintenanceGateStatus(repo).gate?.expired,
    false,
    "the active acquirer keeps its draining lease alive",
  );
  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  const acquired = await acquiredResult;
  assert.equal(acquired.ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("acquisition does not return success after its final audit outlives the lease", async () => {
  const repo = makeRepo();
  // The lease must be alive at the promotion checkpoint (which reports a plain
  // "expired") and dead at the final ownership audit (the only checkpoint that
  // reports "expired-before-return"). Expiring it by sleeping made that a race
  // the test could not win: acquisition's own file I/O between gate creation
  // and the audit append measured 1.3s-4.4s on a loaded machine, so a short
  // ttlMs died at promotion instead and the test failed ~1 run in 6. Raising
  // ttlMs only moves the boundary, because the sleep has to outlast it.
  //
  // So stop racing the clock. Give the lease a ttl no setup delay can exhaust,
  // and expire it exactly where this test means to — backdate heartbeatAt as
  // the gate-acquired audit line is written, which is after promotion and
  // before the final audit. gateExpired() is a plain heartbeatAt + ttlMs
  // comparison and clockRegressed() only fires on FUTURE heartbeats, so a
  // backdated one reads as unambiguously expired rather than merely late.
  // Shift acquiredAt with it: validateGate requires heartbeatAt >= acquiredAt,
  // so moving the heartbeat alone makes the gate malformed instead of expired,
  // and the cleanup on the rejection path then fails with gate-cleanup-failed.
  // This is what expireGate() above does; it has to be inlined here because the
  // shim runs inside the spawned child, which shares no scope with this file.
  const TTL_MS = 60_000;
  const worker = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const originalAppend = fs.appendFileSync;
    fs.appendFileSync = (target, content, options) => {
      if (String(content).includes('"event":"gate-acquired"')) {
        fs.appendFileSync = originalAppend;
        // audit.jsonl and gate.json share the gate root directory.
        const gateFile = path.join(path.dirname(String(target)), "gate.json");
        const gate = JSON.parse(fs.readFileSync(gateFile, "utf8"));
        const shiftMs = gate.ttlMs + 1000;
        gate.acquiredAt = new Date(Date.parse(gate.acquiredAt) - shiftMs).toISOString();
        gate.heartbeatAt = new Date(Date.parse(gate.heartbeatAt) - shiftMs).toISOString();
        fs.writeFileSync(gateFile, JSON.stringify(gate, null, 2));
      }
      return originalAppend(target, content, options);
    };
    syncBuiltinESMExports();
    const gate = await import(${JSON.stringify(moduleUrl.href)});
    const result = gate.acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
      ttlMs: ${TTL_MS},
    });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const acquired = await collectChild(child);
  assert.equal(acquired.ok, false);
  assert.equal(acquired.reason, "expired-before-return");
  rmSync(repo, { recursive: true, force: true });
});

test("final verification failure cleans up its exact owned gate", async () => {
  const repo = makeRepo();
  const worker = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const originalAppend = fs.appendFileSync;
    fs.appendFileSync = (target, content, options) => {
      if (String(content).includes('"event":"gate-acquired"')) {
        const gateFile = path.join(path.dirname(target), "gate.json");
        const gate = JSON.parse(fs.readFileSync(gateFile, "utf8"));
        fs.writeFileSync(gateFile, JSON.stringify({
          ...gate,
          heartbeatAt: new Date(Date.now() + 60_000).toISOString(),
        }));
      }
      return originalAppend(target, content, options);
    };
    syncBuiltinESMExports();
    const gate = await import(${JSON.stringify(moduleUrl.href)});
    const result = gate.acquireMaintenanceGate({
      ownerId: "curator",
      repoDir: process.argv[1],
    });
    console.log(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, repo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const acquired = await collectChild(child);
  assert.equal(acquired.reason, "clock-regressed");
  assert.equal(maintenanceGateStatus(repo).gate, null);
  rmSync(repo, { recursive: true, force: true });
});

test("the gate lives in the shared git common dir: linked worktrees see one gate", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "seed.txt"), "seed");
  execFileSync("git", ["-C", repo, "add", "seed.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"]);
  const linked = path.join(repo, ".worktrees", "linked");
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "linked", linked]);

  assert.equal(
    maintenanceGateRoot(linked),
    maintenanceGateRoot(repo),
    "both checkouts resolve the same gate root",
  );
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);
  assert.equal(
    registerWriterIntent({ writerId: "linked-writer", repoDir: linked }).reason,
    "maintenance-gate-held",
    "a writer in a linked worktree is rejected by the main checkout's gate",
  );
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("concurrent multi-process acquisition: exactly one winner", async () => {
  const repo = makeRepo();
  const contenders = 6;
  const barrier = path.join(repo, "barrier");
  mkdirSync(barrier);
  const worker = `
    import { existsSync, writeFileSync } from "node:fs";
    import path from "node:path";
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const [ownerId, repoDir, barrier] = process.argv.slice(1);
    writeFileSync(path.join(barrier, ownerId + ".ready"), "ready");
    while (!existsSync(path.join(barrier, "start"))) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    const result = acquireMaintenanceGate({ ownerId, repoDir, quiesceTimeoutMs: 2000 });
    console.log(JSON.stringify({ ok: result.ok, reason: result.reason ?? null }));
  `;
  const results = [];
  for (let i = 0; i < contenders; i += 1) {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", worker, `owner-${i}`, repo, barrier],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    results.push(collectChild(child));
  }
  await waitUntil(
    () => readdirSync(barrier).filter((name) => name.endsWith(".ready")).length === contenders,
    "not every acquisition contender reached the start barrier",
  );
  writeFileSync(path.join(barrier, "start"), "start");
  const settled = await Promise.all(results);
  const winners = settled.filter((result) => result.ok);
  assert.equal(winners.length, 1, `exactly one of ${contenders} concurrent acquirers wins: ${JSON.stringify(settled)}`);
  assert.ok(
    settled.filter((result) => !result.ok).every((result) => result.reason === "gate-held"),
    "every loser sees gate-held",
  );
  rmSync(repo, { recursive: true, force: true });
});

test("writer lease heartbeat keeps a long-running mutation live", async () => {
  const gate = await import("./maintenance-gate.mjs");
  assert.equal(typeof gate.heartbeatWriterIntent, "function", "writer leases need a token-fenced heartbeat");

  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "long-writer", repoDir: repo });
  assert.equal(intent.ok, true);
  assert.equal(gate.heartbeatWriterIntent(intent.lease).ok, true);
  const intentFile = intentFileForLease(intent.lease);
  const heartbeated = JSON.parse(readFileSync(intentFile, "utf8"));
  writeFileSync(
    intentFile,
    JSON.stringify({
      ...heartbeated,
      heartbeatAt: new Date(Date.now() + MAX_SAFE_TEST_OFFSET).toISOString(),
    }),
  );
  const blocked = acquireMaintenanceGate({
    ownerId: "curator",
    repoDir: repo,
    quiesceTimeoutMs: 100,
  });
  assert.equal(blocked.reason, "intent-clock-regressed");
  assert.equal(maintenanceGateStatus(repo).gate, null);
  assert.equal(
    gate.heartbeatWriterIntent(intent.lease).reason,
    "heartbeat-regressed",
  );
  writeFileSync(intentFile, JSON.stringify(heartbeated));
  assert.deepEqual(maintenanceGateStatus(repo).liveIntents, ["long-writer"]);
  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("a stale writer cannot delete a successfully renewed lease", async () => {
  const repo = makeRepo();
  const first = registerWriterIntent({
    writerId: "writer-race",
    repoDir: repo,
  });
  assert.equal(first.ok, true);

  const ready = path.join(repo, "release-ready");
  const proceed = path.join(repo, "release-proceed");
  const child = spawnPausedMutation({
    mode: "intent-release",
    ready,
    proceed,
    payload: { lease: first.lease },
  });
  const childResult = collectChild(child);
  await waitUntil(() => existsSync(ready), "stale writer never reached its final release mutation");
  expireIntent(first.lease);

  const renewed = registerWriterIntent({
    writerId: "writer-race",
    repoDir: repo,
  });
  writeFileSync(proceed, "proceed");
  const released = await childResult;

  assert.equal(
    renewed.ok && released.ok,
    false,
    "renewal and the stale writer's later pathname removal must not both succeed",
  );
  if (renewed.ok) {
    assert.deepEqual(maintenanceGateStatus(repo).liveIntents, ["writer-race"]);
  } else {
    assert.equal(released.ok, true);
  }
  rmSync(repo, { recursive: true, force: true });
});

test("writer lease lifecycle: duplicate ids rejected, expiry renews, wrong token cannot release", () => {
  const repo = makeRepo();
  const first = registerWriterIntent({ writerId: "w1", repoDir: repo, ttlMs: 60_000 });
  assert.equal(first.ok, true);
  assert.equal(registerWriterIntent({ writerId: "w1", repoDir: repo }).reason, "writer-already-active");
  assert.equal(releaseWriterIntent({ ...first.lease, token: "0000000000000000" }).reason, "not-owner");

  // An expired lease renews in place for the same writer id.
  const expired = registerWriterIntent({ writerId: "w2", repoDir: repo });
  assert.equal(expired.ok, true);
  expireIntent(expired.lease);
  const renewed = registerWriterIntent({ writerId: "w2", repoDir: repo });
  assert.equal(renewed.ok, true);
  assert.notEqual(renewed.lease.token, expired.lease.token);

  const portable = registerWriterIntent({ writerId: "writer:CON", repoDir: repo });
  assert.equal(portable.ok, true);
  assert.ok(maintenanceGateStatus(repo).liveIntents.includes("writer:CON"));
  assert.equal(releaseWriterIntent(portable.lease).ok, true);

  assert.equal(registerWriterIntent({ writerId: "../escape", repoDir: repo }).reason, "invalid-writer-id");
  rmSync(repo, { recursive: true, force: true });
});

test("every transition lands in the audit log with its generation", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const intent = registerWriterIntent({ writerId: "w", repoDir: repo });
  releaseWriterIntent(intent.lease);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  releaseMaintenanceGate(acquired.handle);

  const events = readFileSync(path.join(root, "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).event);
  assert.deepEqual(
    events,
    ["intent-registered", "intent-released", "gate-draining", "gate-acquired", "gate-released"],
    "the audit trail records the full lifecycle in order",
  );
  rmSync(repo, { recursive: true, force: true });
});
