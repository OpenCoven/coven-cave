// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const terminal = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const rust = readFileSync(new URL("../../src-tauri/src/pty.rs", import.meta.url), "utf8");

assert.match(
  terminal,
  /export type TerminalHealth = "starting" \| "healthy" \| "recovering" \| "failed"/,
  "terminal health has an explicit public contract",
);
assert.match(
  terminal,
  /onHealthChange\?: \(health: TerminalHealth\) => void/,
  "terminal hosts can observe shell health",
);
assert.match(
  terminal,
  /bridge\.invoke<[^>]+>\("pty_diagnose"\)/,
  "desktop startup proves native PTY plumbing before reporting healthy",
);
assert.match(
  terminal,
  /setInterval\([\s\S]*?bridge\.invoke<string\[]>\("pty_list"\)[\s\S]*?DESKTOP_HEALTH_INTERVAL_MS/,
  "a visible desktop terminal continuously verifies that its PTY remains registered",
);
assert.match(
  terminal,
  /setStartError\("The shell process stopped responding\. Retry to start a fresh attachment\."\)/,
  "a missed PTY registry entry fails visibly instead of leaving a dead canvas",
);
assert.match(
  terminal,
  /setHealth\("healthy"\)/,
  "successful startup publishes healthy state",
);
assert.match(
  terminal,
  /setHealth\("recovering"\)/,
  "retry and reconnect paths publish recovery state",
);

assert.match(
  rust,
  /pub async fn pty_diagnose\(/,
  "native diagnostics run asynchronously rather than blocking the WebView command thread",
);
assert.match(
  rust,
  /run_pty_start_worker\(run_pty_diagnose\)\.await/,
  "the diagnostic reuses the guarded blocking worker",
);

console.log("bottom-terminal-health.test.ts: ok");
