// @ts-nocheck
// Windows npm installs create command shims in %APPDATA%\npm and expose
// executables through semicolon-delimited PATH entries. Cave must preserve
// that shape when launched as a desktop app, otherwise /api/onboarding/status
// can find `coven` while later spawns still fail with ENOENT.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { covenLaunchCommandForBinary } from "./coven-bin.ts";

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
  /FORBIDDEN_SPAWN_ENV_KEYS = \["GITHUB_PAT", "GITHUB_PERSONAL_ACCESS_TOKEN"\]/,
  "coven child processes strip both legacy and marketplace GitHub token env vars",
);

assert.match(
  source,
  /export function refreshCovenSpawnEnv\(\)[\s\S]*cachedPath = null[\s\S]*return covenSpawnEnv\(\)/,
  "desktop install retries can refresh Cave's cached PATH after Node/npm is installed",
);

assert.deepEqual(
  covenLaunchCommandForBinary("/usr/local/bin/coven", "darwin"),
  { command: "/usr/local/bin/coven", fixedArgs: [] },
  "non-Windows platforms launch the resolved coven binary directly",
);

const npmShimDir = await mkdtemp(path.join(os.tmpdir(), "coven-npm-shim-"));
const npmShimScript = path.join(npmShimDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
await mkdir(path.dirname(npmShimScript), { recursive: true });
await writeFile(npmShimScript, "console.log('coven');\n");
const npmShim = path.join(npmShimDir, "coven.cmd");
await writeFile(
  npmShim,
  [
    "@ECHO off",
    "SETLOCAL",
    "CALL :find_dp0",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\cli\\bin\\coven.js" %*',
    "",
  ].join("\r\n"),
);

assert.deepEqual(
  covenLaunchCommandForBinary(npmShim, "win32"),
  { command: process.execPath, fixedArgs: [npmShimScript] },
  "Windows npm .cmd shims launch through node plus the shim target script",
);

const fallbackShimDir = await mkdtemp(path.join(os.tmpdir(), "coven-fallback-shim-"));
const fallbackScript = path.join(fallbackShimDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
await mkdir(path.dirname(fallbackScript), { recursive: true });
await writeFile(fallbackScript, "console.log('fallback coven');\n");
const fallbackShim = path.join(fallbackShimDir, "coven.cmd");
await writeFile(fallbackShim, "@ECHO off\r\nREM unknown shim shape\r\n");

assert.deepEqual(
  covenLaunchCommandForBinary(fallbackShim, "win32"),
  { command: process.execPath, fixedArgs: [fallbackScript] },
  "Windows .cmd shims fall back to the standard npm global coven.js location",
);

console.log("coven-bin.test.ts: ok");
