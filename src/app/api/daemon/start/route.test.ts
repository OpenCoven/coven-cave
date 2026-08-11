// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /startLocalDaemonOperation\(\{[\s\S]*restart,[\s\S]*automatic,[\s\S]*diagnostics: daemonDiagnosticContextFromRequest\(request\),[\s\S]*\}\)/,
  "daemon start should pass restart, automatic intent, and request correlation to the shared starter",
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
  /const automatic = body\?\.automatic === true/,
  "daemon start route should accept explicit automatic-recovery intent",
);

assert.match(
  source,
  /status: "status" in result \? result\.status : 200/,
  "daemon start route should preserve helper-provided error statuses",
);

assert.match(
  source,
  /\[DAEMON_DIAGNOSTIC_CORRELATION_HEADER\]: operation\.diagnostics\.correlationId/,
  "daemon start route should return the correlation id in a response header",
);

console.log("daemon start route.test.ts: ok");
