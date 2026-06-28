// @ts-nocheck
// Windows npm installs create command shims in %APPDATA%\npm and expose
// executables through semicolon-delimited PATH entries. Cave must preserve
// that shape when launched as a desktop app, otherwise /api/onboarding/status
// can find `coven` while later spawns still fail with ENOENT.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./coven-bin.ts", import.meta.url), "utf8");

assert.match(
  source,
  /process\.platform === "win32"[\s\S]*APPDATA[\s\S]*"npm"/,
  "Windows discovery includes the npm global shim directory under %APPDATA%\\npm",
);

assert.match(
  source,
  /process\.platform === "win32"[\s\S]*"coven\.cmd"/,
  "Windows discovery checks the npm coven.cmd shim, not only the POSIX coven file",
);

assert.match(
  source,
  /split\(path\.delimiter\)/,
  "spawn PATH parsing uses the platform delimiter instead of hard-coded ':'",
);

assert.match(
  source,
  /join\(path\.delimiter\)/,
  "spawn PATH joining uses the platform delimiter instead of hard-coded ':'",
);

assert.match(
  source,
  /export function refreshCovenSpawnEnv\(\)[\s\S]*cachedPath = null[\s\S]*return covenSpawnEnv\(\)/,
  "desktop install retries can refresh Cave's cached PATH after Node/npm is installed",
);

console.log("coven-bin.test.ts: ok");
