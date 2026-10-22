import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  cleanupOwnedGroups,
  isolatedEnvironment,
  runDaemonLifecycleProbe,
  runOwnedCommand,
  summarizeSamples,
  validateReadyDaemon,
} from "./daemon-lifecycle-probe.mjs";

const home = path.resolve(os.tmpdir(), "synthetic-coven");
const status = { ok: true, status: "running", pid: 123, socket: path.join(home, "coven.sock"), started_at: "2026-10-20T00:00:00Z" };
const health = { ok: true, apiVersion: "coven.daemon.v1", covenVersion: "0.4.10",
  daemon: { pid: 123, socket: status.socket, startedAt: status.started_at } };

test("readiness requires the supported contract and the authenticated CLI instance", () => {
  assert.doesNotThrow(() => validateReadyDaemon(status, health, home));
  for (const changed of [
    { ...health, apiVersion: "coven.daemon.v999" },
    { ...health, ok: false },
    { ...health, covenVersion: "unknown" },
    { ...health, daemon: { ...health.daemon, pid: 456 } },
    { ...health, daemon: { ...health.daemon, socket: "/tmp/foreign/coven.sock" } },
    { ...health, daemon: { ...health.daemon, startedAt: "different" } },
  ]) assert.throws(() => validateReadyDaemon(status, changed, home));
  assert.throws(() => validateReadyDaemon({ ...status, ok: false }, health, home));
  assert.throws(() => validateReadyDaemon({ ...status, status: "stale" }, health, home));
  assert.throws(() => validateReadyDaemon(status, health, "/tmp/foreign"));
});

test("one failed sample and cleanup failure cannot become aggregate success", () => {
  const passing = { pass: true, cleanup: true, operations: [{ name: "fresh-start", pass: true, durationMs: 10 }] };
  const failed = { pass: false, cleanup: false, operations: [{ name: "fresh-start", pass: false, durationMs: 5000 }] };
  const result = summarizeSamples([passing, failed, passing]);
  assert.equal(result.pass, false);
  assert.equal(result.passedSamples, 2);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.operations["fresh-start"], {
    attempts: 3, passed: 2, durationsMs: [10, 5000, 10], medianMs: 10, minMs: 10, maxMs: 5000,
  });
  assert.equal(summarizeSamples([]).pass, false);
  assert.equal(summarizeSamples([{ ...passing, cleanup: false }]).pass, false);
});

test("cleanup inspects surviving groups, even after their leaders have exited", async () => {
  const signals = [];
  const groups = new Map([[123, null], [456, null]]);
  const result = await cleanupOwnedGroups(groups, {
    alive: pid => pid === 456,
    signal: (pid, signal) => signals.push([pid, signal]),
    timeoutMs: 0,
  });
  assert.equal(result, false, "a surviving group must fail cleanup");
  assert.deepEqual(signals, [[456, "SIGTERM"], [456, "SIGKILL"]]);
});

test("transient permission uncertainty needs definitive absence and never authorizes a signal", async () => {
  const groups = new Map([[123, null]]);
  const signals = [];
  let observations = 0;
  const result = await cleanupOwnedGroups(groups, {
    alive: () => {
      if (++observations <= 2) throw Object.assign(new Error("unknown group"), { code: "EPERM" });
      return false;
    },
    signal: (...args) => signals.push(args),
  });
  assert.equal(result, true);
  assert.ok(observations >= 3, "the permission error is not proof of absence");
  assert.deepEqual(signals, []);
  assert.equal(groups.size, 0);
});

test("confirmed-absent group IDs are retired before later cleanup observations", async () => {
  const groups = new Map([[123, null], [456, null]]);
  const signals = [];
  let absentObservations = 0;
  await cleanupOwnedGroups(groups, {
    alive: pid => {
      if (pid === 123) {
        assert.equal(++absentObservations, 1, "an absent ID must never be observed again");
        return false;
      }
      return true;
    },
    signal: (...args) => signals.push(args),
    timeoutMs: 0,
  });
  assert.deepEqual([...groups.keys()], [456]);
  assert.deepEqual(signals, [[456, "SIGTERM"], [456, "SIGKILL"]]);
});

test("persistent uncertainty fails without signaling that group or hiding a live group", async () => {
  const groups = new Map([[123, null], [456, null]]);
  const signals = [];
  await assert.rejects(cleanupOwnedGroups(groups, {
    alive: pid => {
      if (pid === 123) throw Object.assign(new Error("unknown group"), { code: "EPERM" });
      return true;
    },
    signal: (...args) => signals.push(args),
    timeoutMs: 0,
  }), { code: "EPERM" });
  assert.ok(groups.has(123) && groups.has(456));
  assert.ok(signals.every(([pid]) => pid === 456));
});

test("uncertainty observed while waiting cannot be forgotten before escalation", async () => {
  const groups = new Map([[123, null]]);
  const signals = [];
  let observations = 0;
  await assert.rejects(cleanupOwnedGroups(groups, {
    alive: () => {
      observations++;
      if (observations === 2) throw Object.assign(new Error("unknown group"), { code: "EPERM" });
      return !signals.some(([, signal]) => signal === "SIGKILL");
    },
    signal: (...args) => signals.push(args),
    timeoutMs: 1000,
  }), { code: "EPERM" });
  assert.ok(observations >= 3, "exercise a later live observation after uncertainty");
  assert.deepEqual(signals, [[123, "SIGTERM"]]);
  assert.ok(groups.has(123));
});

test("resolved uncertainty does not prevent escalation for a separate surviving group", async () => {
  const groups = new Map([[123, null], [456, null]]);
  const signals = [];
  let uncertainObservations = 0;
  assert.equal(await cleanupOwnedGroups(groups, {
    alive: pid => {
      if (pid === 123) {
        if (++uncertainObservations === 1) throw Object.assign(new Error("unknown group"), { code: "EPERM" });
        return false;
      }
      return !signals.some(([id, signal]) => id === 456 && signal === "SIGKILL");
    },
    signal: (...args) => signals.push(args),
    timeoutMs: 0,
  }), true);
  assert.deepEqual(signals, [[456, "SIGTERM"], [456, "SIGKILL"]]);
  assert.equal(groups.size, 0);
});

test("a completed command retires its definitively absent process group", { skip: process.platform === "win32" }, async () => {
  const groups = new Map();
  const result = await runOwnedCommand(process.execPath, ["-e", ""], { cwd: os.tmpdir(), env: {}, groups });
  assert.equal(result.code, 0);
  assert.equal(groups.size, 0);
});

test("command completion preserves uncertainty for subsequent cleanup", { skip: process.platform === "win32" }, async () => {
  const groups = new Map();
  const signals = [];
  const kill = process.kill;
  try {
    try {
      process.kill = function (pid, signal) {
        if (pid < 0 && signal === 0) throw Object.assign(new Error("unknown group"), { code: "EPERM" });
        return kill.call(this, pid, signal);
      };
      const result = await runOwnedCommand(process.execPath, ["-e", ""], { cwd: os.tmpdir(), env: {}, groups });
      assert.equal(result.code, 0);
    } finally {
      process.kill = kill;
    }
    await assert.rejects(cleanupOwnedGroups(groups, {
      alive: () => true,
      signal: (...args) => signals.push(args),
      timeoutMs: 0,
    }), { code: "EPERM" });
    assert.deepEqual(signals, []);
  } finally {
    await cleanupOwnedGroups(groups);
  }
});

test("a denied command termination cannot escalate or forget the uncertainty", { skip: process.platform === "win32" }, async () => {
  const groups = new Map();
  const signals = [];
  const kill = process.kill;
  try {
    try {
      process.kill = function (pid, signal) {
        if (pid < 0 && signal !== 0) {
          signals.push(signal);
          if (signal === "SIGTERM") throw Object.assign(new Error("synthetic denial"), { code: "EPERM" });
        }
        return kill.call(this, pid, signal);
      };
      const result = await runOwnedCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cwd: os.tmpdir(), env: {}, groups, timeoutMs: 100,
      });
      assert.equal(result.timedOut, true);
    } finally {
      process.kill = kill;
    }
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(groups.size, 1);
    assert.equal([...groups.values()][0].code, "EPERM");
  } finally {
    // The denial above was injected: restore real signaling for this still-owned
    // live fixture. No production cleanup may override actual uncertainty.
    for (const pid of groups.keys()) {
      try { kill.call(process, -pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await cleanupOwnedGroups(groups);
  }
});

test("command completion retains a surviving descendant in the same group for cleanup", { skip: process.platform === "win32" }, async () => {
  const groups = new Map();
  try {
    const code = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      console.log(child.pid);child.unref();`;
    const result = await runOwnedCommand(process.execPath, ["-e", code], { cwd: os.tmpdir(), env: {}, groups });
    assert.equal(result.code, 0);
    const descendant = Number(result.stdout.trim());
    assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
    assert.doesNotThrow(() => process.kill(descendant, 0));
    assert.equal(groups.size, 1, "launcher exit must retain the descendant's group");
    assert.equal(await cleanupOwnedGroups(groups), true);
    assert.equal(groups.size, 0);
  } finally {
    await cleanupOwnedGroups(groups);
  }
});

test("child environment uses only private fixture paths and an explicit allowlist", () => {
  const env = isolatedEnvironment("/tmp/private-probe");
  assert.equal(env.COVEN_HOME, path.join("/tmp/private-probe", "coven"));
  assert.equal(env.HOME, path.join("/tmp/private-probe", "user"));
  assert.equal(env.COVEN_SOCKET, path.join("/tmp/private-probe", "coven/coven.sock"));
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.deepEqual(Object.keys(env).sort(), [
    "COVEN_HOME", "COVEN_SOCKET", "HOME", "LANG", "PATH", "TMPDIR", "TZ",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  ]);
});

test("missing and hung executables are bounded failures and leave no owned group", { skip: process.platform === "win32" }, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cave-probe-test-")));
  const groups = new Map();
  try {
    const missing = await runOwnedCommand(path.join(root, "missing"), [], { cwd: root, env: {}, groups });
    assert.equal(missing.spawnFailed, true);
    const hung = await runOwnedCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: root, env: {}, groups, timeoutMs: 100,
    });
    assert.equal(hung.timedOut, true);
    assert.equal(await cleanupOwnedGroups(groups), true);
  } finally {
    await cleanupOwnedGroups(groups);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing binary returns failed evidence, not a successful empty benchmark", { skip: process.platform === "win32" }, async () => {
  const result = await runDaemonLifecycleProbe({ binary: "/nonexistent/coven-probe", samples: 1 });
  assert.equal(result.pass, false);
  assert.equal(result.error, "binary_unavailable");
  assert.equal(result.samples.length, 0);
});

test("unverifiable cleanup returns redacted failed evidence", { skip: process.platform === "win32" }, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cave-cleanup-test-")));
  const binary = path.join(root, "fixture-coven");
  const groups = new Map();
  writeFileSync(binary, `#!${process.execPath}\nconsole.log('coven v0.0.1');\n`, { mode: 0o700 });
  try {
    for (const [phase, code, classification] of [
      ["version", "EPERM", "permission_denied"],
      ["version", "UNKNOWN", "probe_failed"],
      ["sample", "EMFILE", "resource_exhausted"],
    ]) {
      const script = `
        import { runDaemonLifecycleProbe } from ${JSON.stringify(new URL("./daemon-lifecycle-probe.mjs", import.meta.url).href)};
        const kill = process.kill.bind(process);
        let versionGroup;
        process.kill = (pid, signal) => {
          if (pid < 0 && signal === 0) {
            versionGroup ??= pid;
            if (${JSON.stringify(phase)} === "version" || pid !== versionGroup)
              throw Object.assign(new Error("private fixture diagnostic"), {code: ${JSON.stringify(code)}});
          }
          return kill(pid, signal);
        };
        const report = await runDaemonLifecycleProbe({binary: ${JSON.stringify(binary)}, samples: 1});
        console.log(JSON.stringify(report));
      `;
      const result = await runOwnedCommand(process.execPath, ["--input-type=module", "-e", script], {
        cwd: root, env: {}, groups,
      });
      assert.equal(result.code, 0, "cleanup inspection must return a report rather than throw");
      const report = JSON.parse(result.stdout);
      assert.equal(report.pass, false);
      if (phase === "version") {
        assert.equal(report.error, "version_cleanup_failed");
        assert.equal(report.cleanupFailure, classification);
        assert.deepEqual(report.samples, []);
      } else {
        assert.equal(report.samples.length, 1);
        assert.equal(report.samples[0].operations[0].failure, "status_invalid_json");
        assert.equal(report.samples[0].cleanup, false);
        assert.equal(report.samples[0].cleanupFailure, classification);
      }
      assert.doesNotMatch(result.stdout + result.stderr, /private fixture diagnostic/);
    }
  } finally {
    await cleanupOwnedGroups(groups);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a descendant holding inherited pipes cannot outlive the command deadline", { skip: process.platform === "win32" }, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cave-pipe-test-")));
  const pidFile = path.join(root, "owned-child");
  const groups = new Map();
  let guard;
  try {
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});
      fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();`;
    const result = await Promise.race([
      runOwnedCommand(process.execPath, ["-e", code], { cwd: root, env: {}, groups, timeoutMs: 150 }),
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("command never settled")), 3000); }),
    ]);
    assert.equal(result.timedOut, true);
  } finally {
    clearTimeout(guard);
    if (existsSync(pidFile)) {
      try { process.kill(-Number(readFileSync(pidFile, "utf8")), "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await cleanupOwnedGroups(groups);
    rmSync(root, { recursive: true, force: true });
  }
});

test("SIGTERM retains interrupted evidence and cleans the active detached command", { skip: process.platform === "win32" }, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cave-interrupt-test-")));
  const pidFile = path.join(root, "owned-command");
  const binary = path.join(root, "fixture-coven");
  writeFileSync(binary, `#!${process.execPath}
import fs from 'node:fs';
if(process.argv.includes('--version')) console.log('coven v0.0.1');
else {fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);}
`, { mode: 0o700 });
  const script = fileURLToPath(new URL("./daemon-lifecycle-probe.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", script, binary, "1"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.resume();
  const closed = new Promise(resolve => child.once("close", code => resolve(code)));
  let guard;
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(pidFile) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(pidFile), "fixture must announce its active command before interruption");
    child.kill("SIGTERM");
    const code = await Promise.race([closed,
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("interrupted probe did not finish")), 5000); }),
    ]);
    assert.equal(code, 1);
    const report = JSON.parse(stdout);
    assert.equal(report.pass, false);
    assert.equal(report.error, "cancelled");
    assert.equal(report.samples[0].cleanup, true);
    assert.equal(report.samples[0].operations[0].failure, "cancelled");
    assert.throws(() => process.kill(-Number(readFileSync(pidFile, "utf8")), 0), { code: "ESRCH" });
  } finally {
    clearTimeout(guard);
    child.kill("SIGKILL");
    if (existsSync(pidFile)) {
      try { process.kill(-Number(readFileSync(pidFile, "utf8")), "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
