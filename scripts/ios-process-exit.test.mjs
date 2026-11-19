import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { waitForProcessExit } from "./ios-process-exit.mjs";

async function ownedChild(t) {
  const child = spawn(process.execPath, ["-e", `
    process.stdout.write("ready\\n");
    process.stdin.on("data", () => setTimeout(() => process.exit(0), 50));
    setTimeout(() => process.exit(0), 10_000);
  `], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && !child.stdin.writableEnded) child.stdin.end("exit");
    await exited;
  });
  await once(child.stdout, "data");
  return { child, exited };
}

test("waits for an acknowledged stop whose owned process exits asynchronously", async (t) => {
  const { child } = await ownedChild(t);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  const stopped = waitForProcessExit(child.pid, { timeoutMs: 5_000 });
  child.stdin.end("exit");
  assert.equal(await stopped, true);
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});

test("recognizes an already exited process", async (t) => {
  const { child, exited } = await ownedChild(t);
  child.stdin.end("exit");
  await exited;
  assert.equal(await waitForProcessExit(child.pid), true);
});

test("a deadline does not turn a still-running process into successful cleanup", async (t) => {
  const { child } = await ownedChild(t);
  assert.equal(await waitForProcessExit(child.pid, { timeoutMs: 50 }), false);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
});

test("permission denial remains unknown rather than proving absence", async (t) => {
  t.mock.method(process, "kill", (_pid, signal) => {
    assert.equal(signal, 0);
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  await assert.rejects(waitForProcessExit(process.pid), { code: "EPERM" });
});

test("invalid PIDs and polling bounds never reach the operating system", async (t) => {
  t.mock.method(process, "kill", () => assert.fail("invalid input must not query a process"));
  for (const pid of [0, -1, NaN, "1"]) await assert.rejects(waitForProcessExit(pid), TypeError);
  await assert.rejects(waitForProcessExit(process.pid, { timeoutMs: -1 }), TypeError);
  await assert.rejects(waitForProcessExit(process.pid, { pollMs: 0 }), TypeError);
});
