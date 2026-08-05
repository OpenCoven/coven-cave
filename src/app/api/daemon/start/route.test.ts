// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /startLocalDaemon\(\{ restart, automatic \}\)/,
  "daemon start should pass explicit restart and automatic intent to the shared starter",
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
  /NextResponse\.json\(result, \{ status: "status" in result \? result\.status : 200 \}\)/,
  "daemon start route should preserve helper-provided error statuses",
);

console.log("daemon start route.test.ts: ok");
