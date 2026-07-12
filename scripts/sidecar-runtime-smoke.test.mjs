import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  hasExactlyOneExpectedVersionToken,
  probeVersion,
} from "./sidecar-runtime-smoke.mjs";

test("smoke helpers are import-safe and accept one expected standalone version", () => {
  assert.equal(typeof probeVersion, "function", "importing helpers must not launch the real smoke");

  for (const [output, expectedVersion] of [
    ["coven 0.0.53\n", "0.0.53"],
    ["Coven CLI version v0.0.53", "0.0.53"],
    ["coven-code release: 0.5.1", "0.5.1"],
    ["v0.5.1", "0.5.1"],
  ]) {
    assert.equal(
      hasExactlyOneExpectedVersionToken(output, expectedVersion),
      true,
      `expected one matching version in ${JSON.stringify(output)}`,
    );
  }
});

test("version parsing rejects malformed adjacency, conflicts, duplicates, and absence", () => {
  for (const output of [
    "coven 0.0.53.999",
    "coven 0.0.53-beta",
    "coven 0.0.53+build",
    "coven 0.0.53_rc1",
    "coven x0.0.53",
    "coven 0.0.53x",
    "coven 0.0.53 conflicting-runtime 9.9.9",
    "coven 0.0.53 duplicate 0.0.53",
    "coven version unavailable",
  ]) {
    assert.equal(
      hasExactlyOneExpectedVersionToken(output, "0.0.53"),
      false,
      `must reject ${JSON.stringify(output)}`,
    );
  }
});

class FakeChild extends EventEmitter {
  constructor({ exitOnForce = true } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.exitOnForce = exitOnForce;
    this.kills = [];
    this.reaped = false;
  }

  kill(signal = "SIGTERM") {
    this.kills.push(signal);
    if (signal === "SIGKILL" && this.exitOnForce) {
      setTimeout(() => {
        this.signalCode = "SIGKILL";
        this.reaped = true;
        this.emit("exit", null, "SIGKILL");
        this.emit("close", null, "SIGKILL");
      }, 1);
    }
    return true;
  }
}

test("probe timeout force-kills and observes exit before rejecting", async () => {
  const child = new FakeChild();
  let reapedAtRejection = false;
  const spawnProcess = (binary, argv, options) => {
    assert.equal(binary, "/staged/coven");
    assert.deepEqual(argv, ["--version"]);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    return child;
  };

  const probe = probeVersion("/staged/coven", "0.0.53", {
    spawnProcess,
    probeTimeoutMs: 1,
    gracefulWaitMs: 2,
    forcedWaitMs: 50,
  }).catch((error) => {
    reapedAtRejection = child.reaped;
    throw error;
  });

  await assert.rejects(probe, /timed out probing \/staged\/coven after 1ms/);
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.reaped, true, "forced child exit must be observed");
  assert.equal(reapedAtRejection, true, "timeout must reject only after exit is reaped");
});

test("probe timeout reports an actionable cleanup failure when SIGKILL cannot reap", async () => {
  const child = new FakeChild({ exitOnForce: false });

  await assert.rejects(
    probeVersion("/staged/coven", "0.0.53", {
      spawnProcess: () => child,
      probeTimeoutMs: 1,
      gracefulWaitMs: 2,
      forcedWaitMs: 2,
    }),
    /timed out probing \/staged\/coven[\s\S]*cleanup failed[\s\S]*SIGKILL/,
  );
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
});
