// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const daemonStart = await readFile(new URL("./daemon-start.ts", import.meta.url), "utf8");
const covenDaemon = await readFile(new URL("./coven-daemon.ts", import.meta.url), "utf8");

assert.match(
  covenDaemon,
  /export function localDaemonTarget\(\)[\s\S]*mode: "local"[\s\S]*socketPath: socketPath\(\)/,
  "coven-daemon should expose an explicit local target even when Cave is configured for a hub",
);

assert.match(
  covenDaemon,
  /export async function callDaemonTarget/,
  "coven-daemon should let callers invoke a specific daemon target",
);

assert.match(
  daemonStart,
  /callDaemonTarget\(localDaemonTarget\(\), \{ path: "\/api\/v1\/health", timeoutMs: healthTimeoutMs \}\)/,
  "local daemon wake should check the laptop-local socket before spawning",
);

assert.match(
  daemonStart,
  /spawn\(covenBin\(\), \["daemon", "start"\]/,
  "local daemon wake should start the Coven daemon through the existing CLI command",
);

assert.match(
  daemonStart,
  /shell: process\.platform === "win32"/,
  "local daemon wake should preserve Windows npm shim support",
);

assert.match(
  daemonStart,
  /isMissingExecutableError\(err\)[\s\S]*covenCliMissingError\(\)/,
  "local daemon wake should keep the missing-CLI error contract",
);

console.log("daemon-start.test.ts: ok");
