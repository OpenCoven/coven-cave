// @ts-nocheck
//
// File-read smoke for the board task-chat route. Locks in the
// unsupported-harness branch added alongside this test: when the
// daemon rejects a session with "not a supported harness", trusted
// Chat runtimes reserve a native Chat task and untrusted runtimes get
// an actionable 409 instead of a 502 that reads as "the daemon is broken".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// The route uses extractDaemonError so the nested
// { error: { code, message } } daemon body actually surfaces.
assert.match(
  source,
  /import\s*\{[^}]*\bextractDaemonError\b[^}]*\}\s*from\s*"@\/lib\/coven-daemon"/,
  "route imports extractDaemonError from @/lib/coven-daemon",
);

// The detection regex must remain case-insensitive so we don't miss a
// daemon-side capitalization change.
assert.match(
  source,
  /\/not a supported harness\/i/,
  "route declares an /i regex for 'not a supported harness' detection",
);

// Trusted runtimes use the native Chat handoff instead of losing Board task
// support merely because the daemon lacks their session adapter.
assert.match(
  source,
  /UNSUPPORTED_HARNESS_RE\.test\(daemonMsg\)[\s\S]{0,400}isTrustedChatHarness\(binding\.harness\)[\s\S]{0,100}reserveNativeChatTask\(\)/,
  "route falls back to native Chat when the daemon rejects a trusted runtime",
);

// Untrusted harnesses still return 409, not a generic 502.
assert.match(
  source,
  /isTrustedChatHarness\(binding\.harness\)[\s\S]{0,700}status:\s*409/,
  "route returns 409 when the daemon rejects an unsupported untrusted harness",
);

// The friendly message must name the harness from the binding so the
// user knows which familiar to reassign without reading server logs.
assert.match(
  source,
  /'\$\{binding\.harness\}'/,
  "route names the binding's harness in the friendly message",
);

// The generic-failure path now prefers `daemonMsg` over the bare
// "daemon http <status>" so other 4xx/5xx responses still surface a
// useful message.
assert.match(
  source,
  /error:\s*daemonMsg\s*\?\?\s*res\.error\s*\?\?\s*`daemon http \$\{res\.status\}`/,
  "route falls back to daemonMsg before 'daemon http <status>' on the 502 path",
);

assert.match(
  source,
  /body:\s*\{[\s\S]{0,160}harness:\s*binding\.harness,[\s\S]{0,80}model:\s*binding\.model,/,
  "task sessions forward the familiar's resolved model to the daemon",
);

console.log("board chat route.test.ts: ok");
