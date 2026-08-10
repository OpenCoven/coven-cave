import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "./process-execution.ts";

test("bounded process output strips ANSI, redacts secrets, and retains a capped tail", () => {
  const output = new BoundedProcessOutput(80);
  output.append("\u001b[31mstarting\u001b[0m github_pat_abcdefghijklmnopqrstuvwxyz123456\n");
  output.append("tail-".repeat(40));
  const text = output.text();
  assert.ok(Buffer.byteLength(text) <= 80);
  assert.match(text, /^\[earlier output truncated\]\n/);
  assert.doesNotMatch(text, /\u001b|github_pat_/);
  assert.equal(output.wasTruncated(), true);
});

test("spawn failures use stable path-free diagnostics", () => {
  assert.equal(
    safeProcessErrorMessage(Object.assign(new Error("/private/bin/coven"), { code: "ENOENT" }), "Coven CLI"),
    "Coven CLI executable was not found",
  );
  assert.equal(
    safeProcessErrorMessage(Object.assign(new Error("/private/bin/coven"), { code: "EACCES" }), "Coven CLI"),
    "Coven CLI executable is not permitted",
  );
  assert.equal(
    safeProcessErrorMessage(new Error("/private/bin/coven"), "Coven CLI"),
    "Coven CLI could not be started",
  );
});

test("structured process output can be bounded without rewriting valid JSON", () => {
  const output = new BoundedProcessOutput(200, { redact: false });
  output.append('{"token":"github_pat_abcdefghijklmnopqrstuvwxyz123456"}');
  assert.deepEqual(JSON.parse(output.text()), {
    token: "github_pat_abcdefghijklmnopqrstuvwxyz123456",
  });
});

test("bounded process output enforces its limit in UTF-8 bytes", () => {
  const output = new BoundedProcessOutput(48);
  output.append("prefix-" + "🦇".repeat(20));

  assert.ok(Buffer.byteLength(output.text()) <= 48);
  assert.match(output.text(), /^\[earlier output truncated\]\n/);
  assert.doesNotMatch(output.text(), /\uFFFD/);
});

test("POSIX tree cleanup escalates when a descendant survives the root", {
  skip: process.platform === "win32",
}, async () => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    process.on("SIGTERM", () => process.exit(0));
    process.stdout.write("ready");
    setInterval(() => {}, 1000);
  `], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ok(child.pid);
  try {
    await Promise.race([
      once(child.stdout!, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("fixture did not become ready")), 2_000),
      ),
    ]);
    assert.equal(await terminateProcessTree(child, { graceMs: 500 }), true);
    assert.throws(
      () => process.kill(-child.pid!, 0),
      (error: NodeJS.ErrnoException) => error.code === "ESRCH",
    );
  } finally {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // The expected path already exhausted the process group.
    }
  }
});
