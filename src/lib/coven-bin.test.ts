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

// Modern Node throws EINVAL when spawning a `.cmd`/`.bat` without shell:true
// (CVE-2024-27980). covenInvocation() sidesteps that on Windows by running the
// shim's underlying Node script via `node <script>`, which is also safe for the
// prompt-bearing chat argv (no shell quoting/injection). The two regressions
// this guards against: a 500 on /api/harnesses (blank onboarding "Option A")
// and broken chat spawns on Windows.
assert.match(
  source,
  /export function covenInvocation\(\):/,
  "covenInvocation() is exported for spawn sites to resolve the launch command",
);

assert.match(
  source,
  /process\.platform === "win32"[\s\S]*\\\.\(cmd\|bat\)[\s\S]*process\.execPath/,
  "covenInvocation routes a Windows .cmd/.bat shim through `node` (process.execPath)",
);

assert.match(
  source,
  /resolveWindowsShimTarget[\s\S]*%dp0%[\s\S]*\.\[cm\]\?js/,
  "the shim resolver parses the npm/pnpm .cmd for its node script (.js/.cjs/.mjs) target",
);

console.log("coven-bin.test.ts: ok");
