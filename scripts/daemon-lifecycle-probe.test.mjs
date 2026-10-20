import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  const groups = new Set([123, 456]);
  const result = await cleanupOwnedGroups(groups, {
    alive: pid => pid === 456,
    signal: (pid, signal) => signals.push([pid, signal]),
    timeoutMs: 0,
  });
  assert.equal(result, false, "a surviving group must fail cleanup");
  assert.deepEqual(signals, [[456, "SIGTERM"], [456, "SIGKILL"]]);
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
  const groups = new Set();
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
