// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

// The desktop terminal could hang on "Starting terminal…" forever: a native
// pty_* command that never returns, a transport await that threw, or `platform`
// stuck at "unknown" so neither transport effect ran — all left the spinner up
// with no error and no recovery. These pin the fail-visible + retry behavior.

// ── Watchdog surfaces a stall instead of spinning forever ────────────────────
assert.match(src, /const START_WATCHDOG_MS = \d[\d_]*;/, "a startup watchdog timeout is defined");
assert.match(
  src,
  /if \(ready \|\| unavailable \|\| startError\) return;[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?setStartError\([\s\S]*?\}, START_WATCHDOG_MS\)/,
  "an unresolved startup flips to a visible error after the watchdog window",
);

// ── Both transports surface a thrown/rejected startup instead of hanging ─────
assert.ok(
  (src.match(/setStartError\(`Terminal failed to start: \$\{String\(err\)\}`\)/g) ?? []).length >= 2,
  "both the desktop (Tauri IPC) and the WebSocket startup paths catch + surface a thrown await",
);
assert.match(src, /log\("desktop terminal startup FAILED", err\)/, "the desktop startup failure is logged (forwarded to Rust)");

// ── Retry re-runs the transport effects ──────────────────────────────────────
assert.match(src, /const retryStart = useCallback\(\(\) => \{[\s\S]*?setRetryNonce\(\(n\) => n \+ 1\)/, "Retry bumps the nonce that re-runs startup");
assert.match(src, /\}, \[threadId, platform, openFind, retryNonce\]\)/, "the desktop transport effect re-runs on retry");
assert.match(src, /\}, \[threadId, platform, pushToMirror, openFind, retryNonce\]\)/, "the WebSocket transport effect re-runs on retry");

// ── The overlay shows the error + a Retry button (not just the spinner) ──────
assert.match(src, /\{!ready && startError \?/, "the error state replaces the spinner overlay");
assert.match(src, /onClick=\{retryStart\}[\s\S]*?Retry/, "the error overlay offers a Retry control");

console.log("bottom-terminal-startup-watchdog.test.ts: ok");
