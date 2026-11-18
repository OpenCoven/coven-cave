// The runtime activity harnesses' teardown must never turn a passing suite
// into an uncaught crash (#6340). These cases pin the helper's contract with
// injected fs functions, one real-filesystem removal, and a source guard that
// every harness routes its root removal through the helper.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import * as teardown from "./native-harness-teardown.mjs";
import test from "node:test";

import { LATE_WRITE_LISTING_LIMIT, lateWriteRecord, removeFixtureRoot } from "./native-harness-teardown.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const HARNESSES = [
  "runtime-activity-native-transport.mjs",
  "runtime-activity-effect-recovery.mjs",
  "runtime-activity-client-fixture.mjs",
  "runtime-activity-browser-fixture.mjs",
];

function fsError(code, target) {
  const error = new Error(`${code}: synthetic, rmdir '${target}'`);
  error.code = code;
  error.syscall = "rmdir";
  error.path = target;
  return error;
}

test("a clean removal reports removed and asks rm for its own retry budget", async () => {
  const calls = [];
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async (target, options) => { calls.push({ target, options }); },
    readdir: async () => { throw new Error("readdir must not run on success"); },
  });
  assert.deepEqual(result, { removed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "/synthetic/root");
  assert.deepEqual(calls[0].options, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("a persistent late write names what is under the directory rm could not empty, recursively", async () => {
  const offending = "/synthetic/root/coven/cave";
  let listed = null;
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", offending); },
    readdir: async (target, options) => {
      listed = { target, options };
      return ["sessions", "sessions/abc/turns.jsonl", "cave.log"];
    },
  });
  assert.deepEqual(listed, { target: offending, options: { recursive: true } },
    "the listing targets the directory rm could not empty and descends into it");
  assert.equal(result.removed, false);
  assert.equal(result.code, "ENOTEMPTY");
  assert.equal(result.path, offending);
  assert.match(result.message, /ENOTEMPTY/, "the error text, which carries the rmdir path, is kept");
  assert.deepEqual(result.entries, ["cave.log", "sessions", "sessions/abc/turns.jsonl"], "relative paths, sorted");
  assert.equal(result.truncated, false);
  assert.deepEqual(lateWriteRecord(result), {
    code: "ENOTEMPTY", path: offending, message: result.message,
    entries: ["cave.log", "sessions", "sessions/abc/turns.jsonl"], truncated: false,
  });
});

test("a transient writer reads as an empty listing, distinct from an unlistable one", async () => {
  const transient = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", "/synthetic/root/coven/cave"); },
    readdir: async () => [],
  });
  assert.deepEqual(transient.entries, []);
  const unlistable = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("EPERM", "/synthetic/root/coven"); },
    readdir: async () => { throw fsError("ENOENT", "/synthetic/root/coven"); },
  });
  assert.equal(unlistable.removed, false);
  assert.equal(unlistable.code, "EPERM");
  assert.equal(unlistable.entries, null);
});

test("a runaway writer's listing is capped and marked truncated", async () => {
  const many = Array.from({ length: LATE_WRITE_LISTING_LIMIT + 25 }, (_, index) => `f${String(index).padStart(3, "0")}`);
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", "/synthetic/root/coven/cave"); },
    readdir: async () => many,
  });
  assert.equal(result.entries.length, LATE_WRITE_LISTING_LIMIT);
  assert.equal(result.truncated, true);
  assert.equal(result.entries[0], "f000");
});

test("an error without a path or code falls back to the root and UNKNOWN", async () => {
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw new Error("no fields"); },
    readdir: async () => [],
  });
  assert.equal(result.removed, false);
  assert.equal(result.path, "/synthetic/root");
  assert.equal(result.code, "UNKNOWN");
  assert.equal(result.message, "no fields");
});

test("the helper refuses an empty root rather than removing nothing silently", async () => {
  await assert.rejects(() => removeFixtureRoot(""), TypeError);
  await assert.rejects(() => removeFixtureRoot(undefined), TypeError);
});

test("a real nested fixture root is removed with the default fs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-native-teardown-test-"));
  try {
    const cave = path.join(root, "coven", "cave");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "late.log"), "late write\n");
    const result = await removeFixtureRoot(root, { retryDelay: 1 });
    assert.deepEqual(result, { removed: true });
    await assert.rejects(() => stat(root), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a real directory is listed recursively when removal is refused", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-native-teardown-list-"));
  try {
    await mkdir(path.join(root, "coven", "cave", "sessions"), { recursive: true });
    await writeFile(path.join(root, "coven", "cave", "sessions", "turns.jsonl"), "{}\n");
    const result = await removeFixtureRoot(root, {
      rm: async () => { throw fsError("ENOTEMPTY", path.join(root, "coven", "cave")); },
    });
    assert.deepEqual(result.entries, ["sessions", path.join("sessions", "turns.jsonl")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every runtime activity harness routes its root removal through the helper", async () => {
  for (const name of HARNESSES) {
    const source = await readFile(path.join(here, name), "utf8");
    assert.match(source, /import \{[^}]*\bremoveFixtureRoot\b[^}]*\} from ["']\.\/native-harness-teardown\.mjs["'];/, `${name} imports the helper`);
    assert.match(source, /await removeFixtureRoot\(root\b/, `${name} removes its root through the helper`);
    assert.doesNotMatch(source, /\brm\(\s*root\b/, `${name} no longer calls rm on its root directly`);
    assert.match(source, /teardownLateWrite/, `${name} records a persistent late write in result.json`);
  }
});

// These cases catch treating stop acknowledgement/EOF or a non-ESRCH probe
// error as process exit, and catch resetting/overrunning the total deadline.
const observeExit = (...args) => teardown.observeOwnedProcessExit(...args);
const absent = () => { throw Object.assign(new Error("no such process"), { code: "ESRCH" }); };
function observationClock() {
  let clock = 0;
  return { now: () => clock, wait: async (milliseconds) => { clock += milliseconds; },
    advance: (milliseconds) => { clock += milliseconds; } };
}

test("definitive immediate ESRCH is accepted without waiting", async () => {
  const clock = observationClock();
  const result = await observeExit(4321, { ...clock, probe: absent });
  assert.equal(result.disappeared, true);
  assert.equal(result.status, "absent");
  assert.equal(result.probes, 1);
  assert.equal(result.elapsedMs, 0);
});

test("delayed disappearance is observed rather than rejected after the first live probe", async () => {
  const clock = observationClock(); let probes = 0;
  const result = await observeExit(4321, { ...clock, probe: () => { if (++probes === 4) absent(); } });
  assert.equal(result.disappeared, true);
  assert.equal(result.probes, 4);
  assert.equal(result.elapsedMs, 150);
});

test("a persistent process exhausts one monotonic five-second budget", async () => {
  const clock = observationClock();
  const result = await observeExit(4321, { ...clock, probe: () => {} });
  assert.equal(result.disappeared, false);
  assert.equal(result.status, "timeout");
  assert.equal(result.budgetMs, 5000);
  assert.equal(result.elapsedMs, 5000);
  assert.equal(result.probes, 100, "no probe starts at or after the deadline");
});

test("probe and scheduling costs consume the same deadline, including a late ESRCH", async () => {
  const clock = observationClock(); let probes = 0;
  const result = await observeExit(4321, { ...clock, probe: () => {
    ++probes; clock.advance(3000); if (probes === 2) absent();
  } });
  assert.equal(result.disappeared, false);
  assert.equal(result.status, "timeout");
  assert.equal(result.probes, 2);
});

for (const code of ["EPERM", "EACCES", "EIO", undefined]) {
  test(`a ${code ?? "code-less"} process probe error fails closed without polling`, async () => {
    const clock = observationClock();
    const result = await observeExit(4321, { ...clock, probe: () => {
      throw Object.assign(new Error("cannot determine process state"), code ? { code } : {});
    } });
    assert.equal(result.disappeared, false);
    assert.equal(result.status, "probe-error");
    assert.equal(result.error.code, code ?? "UNKNOWN");
    assert.equal(result.error.message, "cannot determine process state");
    assert.equal(result.probes, 1);
    assert.equal(result.elapsedMs, 0);
  });
}

for (const thrown of [undefined, null, "unknown thrown value"]) {
  test(`non-Error probe failure ${String(thrown)} remains uncertain`, async () => {
    const result = await observeExit(4321, { ...observationClock(), probe: () => { throw thrown; } });
    assert.equal(result.disappeared, false);
    assert.equal(result.status, "probe-error");
    assert.equal(result.error.code, "UNKNOWN");
    assert.equal(result.probes, 1);
  });
}

for (const pid of [undefined, null, 0, -1, 1.5, "4321", NaN, Infinity, 2147483648]) {
  test(`invalid recorded pid ${String(pid)} cannot authorize probing or removal`, async () => {
    const result = await observeExit(pid, { probe: () => assert.fail("invalid pid must never be probed") });
    assert.equal(result.disappeared, false);
    assert.equal(result.status, "invalid-pid");
    assert.equal(result.probes, 0);
  });
}

async function canonicalTeardown({ root, pid, stop, observe, remove = removeFixtureRoot }) {
  // Execute the real canonical teardown segment without launching its provider,
  // native build, or daemon. Its dependency boundary is the stop command and
  // process observer; no production-only test hook is needed.
  const source = await readFile(path.join(here, "runtime-activity-native-transport.mjs"), "utf8");
  const start = source.lastIndexOf("  if (daemonStarted) {");
  const end = source.indexOf("  try {\n    runReport.candidate.sourceAfter", start);
  assert.ok(start >= 0 && end > start);
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
    "daemonStarted", "native", "runReport", "observeOwnedProcessExit", "fixturePlan", "rm", "lstat", "path", "covenHome", "removeFixtureRoot", "root", "lateWriteRecord", "process",
    source.slice(start, end));
  const report = { passed: true, daemon: { pid }, serverStopped: true, providerStopped: true };
  const processState = { exitCode: 0 };
  await execute(true, stop, report, observe, undefined, rm, (await import("node:fs/promises")).lstat,
    path, path.join(root, "coven"), remove, root, lateWriteRecord, processState);
  return { report, exitCode: processState.exitCode };
}

test("canonical teardown retains the fixture on stop failure, invalid pid, deadline, or uncertain probe", async () => {
  for (const failure of ["stop", "pid", "timeout", "permission"]) {
    const root = await mkdtemp(path.join(tmpdir(), "cave-native-observe-fail-"));
    try {
      const result = await canonicalTeardown({ root, pid: failure === "pid" ? undefined : 4321,
        stop: () => { if (failure === "stop") throw Object.assign(new Error("stop rejected"), { code: "ESTOP" }); },
        observe: (pid) => observeExit(pid, { ...observationClock(), probe: () => {
          if (failure === "permission") throw Object.assign(new Error("not permitted"), { code: "EPERM" });
        } }), remove: () => assert.fail("uncertain daemon state must retain the fixture") });
      assert.equal(result.report.daemonStopped, false, failure);
      assert.equal(result.report.preservedRoot, root, failure);
      assert.equal(result.report.passed, false, failure);
      assert.equal(result.exitCode, 1, failure);
      assert.equal((await stat(root)).isDirectory(), true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

function withinDeadline(promise, label, milliseconds = 2000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function childMessage(child, wanted) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      child.off("message", message); child.off("error", failed);
      child.off("exit", exited); child.off("disconnect", disconnected);
      if (error) reject(error); else resolve();
    };
    const message = (value) => { if (value === wanted) finish(); };
    const failed = (error) => finish(error);
    const exited = () => finish(new Error(`child exited before ${wanted}`));
    const disconnected = () => finish(new Error(`child disconnected before ${wanted}`));
    const timer = setTimeout(() => finish(new Error(`child ${wanted} deadline exceeded`)), 2000);
    child.on("message", message); child.once("error", failed);
    child.once("exit", exited); child.once("disconnect", disconnected);
    if (child.exitCode !== null || child.signalCode !== null) exited();
  });
}

async function childExit(child, milliseconds = 2000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await withinDeadline(once(child, "exit"), "owned child exit", milliseconds);
}

async function releaseTestChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.send("release", () => {});
  try { await childExit(child, 1000); return; } catch { /* release failed */ }
  // Cleanup fallback applies only to this directly forked test fixture, never
  // to the daemon or the production observer's signal-zero probes.
  child.kill("SIGTERM");
  try { await childExit(child, 1000); return; } catch { /* bounded escalation */ }
  child.kill("SIGKILL");
  await childExit(child, 1000);
}

test("socket EOF does not permit canonical root removal while the owned child remains alive", { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-native-eof-"));
  const childFile = path.join(root, "held-child.cjs"); const socketPath = path.join(root, "stop.sock");
  await writeFile(childFile, `const net = require('node:net');
const server = net.createServer((socket) => { socket.end('202 accepted'); server.close(() => process.send('socket-closed')); });
server.listen(process.argv[2], () => process.send('ready'));
process.on('message', (message) => { if (message === 'release') { process.disconnect(); process.exit(0); } });`);
  const child = fork(childFile, [socketPath], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const waitMessage = (wanted) => childMessage(child, wanted);
  try {
    await waitMessage("ready"); const socketClosed = waitMessage("socket-closed");
    const socket = createConnection(socketPath); socket.resume();
    try { await withinDeadline(Promise.all([once(socket, "end"), socketClosed]), "socket EOF and close"); }
    finally { socket.destroy(); }
    process.kill(child.pid, 0); // It explicitly stays alive after EOF until IPC release.
    let firstProbe; const probed = new Promise((resolve) => { firstProbe = resolve; });
    const teardownRun = canonicalTeardown({ root, pid: child.pid, stop: () => {},
      observe: (pid) => observeExit(pid, { probe: (ownedPid) => { firstProbe(); process.kill(ownedPid, 0); } }),
      remove: async (target) => {
        assert.throws(() => process.kill(child.pid, 0), (error) => error.code === "ESRCH",
          "the real canonical removal gate must wait for definitive process disappearance");
        return removeFixtureRoot(target);
      } });
    await withinDeadline(Promise.race([probed, teardownRun.then(() => assert.fail("teardown completed before an exit probe"))]), "first owned process probe", 6000);
    assert.equal((await stat(root)).isDirectory(), true);
    const exited = childExit(child); child.send("release"); await exited;
    const result = await withinDeadline(teardownRun, "canonical teardown", 6000);
    assert.equal(result.report.daemonStopped, true);
    assert.equal(result.report.daemonExitObservation.status, "absent");
    assert.equal(result.report.fixtureRootRemoved, true);
    assert.equal(result.report.passed, true);
    await assert.rejects(() => stat(root), /ENOENT/);
  } finally {
    await releaseTestChild(child);
    await rm(root, { recursive: true, force: true });
  }
});
