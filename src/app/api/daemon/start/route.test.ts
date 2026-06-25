// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /isMissingExecutableError\(err\)[\s\S]*covenCliMissingError\(\)/,
  "daemon start should not surface raw spawn coven ENOENT on new installs",
);

assert.match(
  source,
  /shell: process\.platform === "win32"/,
  "daemon start runs Windows npm .cmd shims through shell mode",
);

assert.match(
  source,
  /export async function POST\(request: Request\)/,
  "daemon start route should inspect the request body",
);

assert.match(
  source,
  /const restart = body\?\.restart === true/,
  "daemon start route should accept an explicit restart option",
);

assert.match(
  source,
  /if \(!restart\) \{[\s\S]*callDaemon\(\{ path: "\/api\/v1\/health", timeoutMs: 1500 \}\)[\s\S]*alreadyRunning: true[\s\S]*\}/,
  "plain start should stay idempotent while restart bypasses the healthy-daemon guard",
);

console.log("daemon start route.test.ts: ok");
