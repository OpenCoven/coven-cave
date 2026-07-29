// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";

const daemonStart = await readFile(new URL("./daemon-start.ts", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("./daemon-readiness.ts", import.meta.url), "utf8");
const covenDaemon = await readFile(new URL("./coven-daemon.ts", import.meta.url), "utf8");

assert.match(covenDaemon, /export function localDaemonTarget\(\)[\s\S]*mode: "local"[\s\S]*socketPath: socketPath\(\)/);
assert.match(daemonStart, /waitForDaemonReadiness/);
assert.match(daemonStart, /path: "\/api\/v1\/health"/);
assert.match(daemonStart, /shell: launchMode === "shell"/);
assert.match(readinessSource, /A final probe closes the race/);
assert.doesNotMatch(daemonStart, /child\.kill\("SIGTERM"\)/, "a timeout must not kill an already-daemonized Windows descendant");
assert.match(daemonStart, /sanitizeAboutDiagnosticText/, "daemon-start responses reuse the value-safe diagnostics sanitizer");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stdout\)/, "launcher stdout is redacted before it reaches a client");
assert.match(daemonStart, /sanitizeDaemonStartDiagnostic\(stderr\)/, "launcher stderr is redacted before it reaches a client");

{
  const safe = sanitizeAboutDiagnosticText(
    "failed at C:\\Users\\Example Person\\.npmrc token=ghp_1234567890abcdefghijklmnopqrstuv",
  );
  assert.doesNotMatch(safe, /Example Person|npmrc|ghp_/, "daemon start diagnostics redact local paths and credentials");
  assert.match(safe, /\[local path omitted\]|\[redacted\]/, "redaction remains apparent to the user");
}

test("a foreground launcher is successful as soon as health becomes ready", async () => {
  let now = 0;
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 3 }),
    timeoutMs: 1000,
    pollMs: 100,
    runnerExited: () => false,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.deepEqual(result, { ready: true, attempts: 3, elapsedMs: 200, runnerExited: false });
});

test("the deadline performs one final health probe before reporting timeout", async () => {
  let now = 0;
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 3 }),
    timeoutMs: 100,
    pollMs: 100,
    runnerExited: () => false,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.deepEqual(result, { ready: true, attempts: 3, elapsedMs: 100, runnerExited: false });
});

test("an exited launcher reports not-ready only after its final probe", async () => {
  let probes = 0;
  const result = await waitForDaemonReadiness({
    probe: async () => ({ ok: ++probes === 2 }),
    timeoutMs: 1000,
    pollMs: 100,
    runnerExited: () => true,
    now: () => 0,
    sleep: async () => assert.fail("an exited launcher should not sleep"),
  });
  assert.deepEqual(result, { ready: true, attempts: 2, elapsedMs: 0, runnerExited: true });
});

console.log("daemon-start.test.ts: ok");
