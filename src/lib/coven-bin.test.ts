// @ts-nocheck
// Windows npm installs create command shims in %APPDATA%\npm and expose
// executables through semicolon-delimited PATH entries. Cave must preserve
// that shape when launched as a desktop app, otherwise /api/onboarding/status
// can find `coven` while later spawns still fail with ENOENT.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { covenAdapterDirsEnvValue, covenLaunchCommandForBinary, pickWindowsLauncher, scrubSidecarInternalEnv, windowsPathFromRegQuery } from "./coven-bin.ts";

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

// ── cave-o01k: sidecar-internal env never reaches children ────────────────────
// Packaged-app children inherited __NEXT_PRIVATE_STANDALONE_CONFIG (breaks any
// `next build`/dev server a session runs — the JSON config has no
// generateBuildId function and bakes CI paths) and COVEN_CAVE_* auth/bundle
// state (401-gates an inherited dev server; the tokens are secrets).
assert.match(
  source,
  /SIDECAR_INTERNAL_ENV_PREFIXES = \["COVEN_CAVE_", "__NEXT_PRIVATE_"\]/,
  "the sidecar-internal namespaces are scrubbed by prefix, so new COVEN_CAVE_* vars stay contained",
);
assert.match(
  source,
  /return scrubSidecarInternalEnv\(env\);\s*\}/,
  "covenSpawnEnv routes through the shared scrub, so agents/CLI probes/installers are all covered",
);
{
  const env = scrubSidecarInternalEnv({
    PATH: "/usr/bin",
    HOME: "/Users/witch",
    COVEN_CAVE_BUNDLE: "1",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret",
    COVEN_CAVE_ACCESS_TOKEN: "mobile-secret",
    COVEN_CAVE_PTY_DETACH_GRACE_MS: "1000",
    __NEXT_PRIVATE_STANDALONE_CONFIG: "{\"distDir\":\"/Users/runner/work\"}",
    __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000",
    GITHUB_PAT: "ghp_x",
    MY_APP_TOKEN: "kept",
  });
  assert.deepEqual(
    env,
    { PATH: "/usr/bin", HOME: "/Users/witch", MY_APP_TOKEN: "kept" },
    "scrubSidecarInternalEnv drops every COVEN_CAVE_*/__NEXT_PRIVATE_* var and forbidden token keys, keeping user env intact",
  );
}
// Every other spawn site that spreads process.env wraps it in the scrub —
// gh/bd/npx/tailscale/vault children run user-visible (or arbitrary,
// via npx postinstall) code and must not see sidecar secrets either.
for (const rel of [
  "../app/api/beads/prs/route.ts",
  "../app/api/beads/route.ts",
  "../app/api/skills/directory/install/route.ts",
  "../app/api/skills/directory/use/route.ts",
  "./branch-pr-context.ts",
  "./mobile-handoff.ts",
  "./vault.ts",
]) {
  const spawnSite = await readFile(new URL(rel, import.meta.url), "utf8");
  assert.match(
    spawnSite,
    /scrubSidecarInternalEnv\(\{ \.\.\.process\.env/,
    `${rel} scrubs sidecar-internal env before spawning`,
  );
  assert.doesNotMatch(
    spawnSite,
    /env: \{ \.\.\.process\.env/,
    `${rel} has no unscrubbed process.env spread left`,
  );
}

assert.match(
  source,
  /export function refreshCovenSpawnEnv\(\)[\s\S]*cachedPath = null[\s\S]*return covenSpawnEnv\(\)/,
  "desktop install retries can refresh Cave's cached PATH after Node/npm is installed",
);
assert.match(
  source,
  /export function refreshCovenBin\(\)[\s\S]*cachedBin = null;[\s\S]*cachedPath = null;[\s\S]*return covenBin\(\)/,
  "CLI updates clear executable and PATH caches before daemon recovery",
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
await writeFile(path.join(npmShimDir, "node.exe"), "local node runtime probe");
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

const covenCodeShimDir = await mkdtemp(path.join(os.tmpdir(), "coven-code-npm-shim-"));
const covenCodeShimScript = path.join(covenCodeShimDir, "node_modules", "@opencoven", "coven-code", "bin", "coven-code");
await mkdir(path.dirname(covenCodeShimScript), { recursive: true });
await writeFile(covenCodeShimScript, "console.log('coven-code');\n");
const covenCodeShim = path.join(covenCodeShimDir, "coven-code.cmd");
await writeFile(
  covenCodeShim,
  [
    "@ECHO off",
    "SETLOCAL",
    "CALL :find_dp0",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\coven-code\\bin\\coven-code" %*',
    "",
  ].join("\r\n"),
);

assert.deepEqual(
  covenLaunchCommandForBinary(covenCodeShim, "win32"),
  { command: process.execPath, fixedArgs: [covenCodeShimScript] },
  "Windows npm .cmd shims can target extensionless package bin scripts like coven-code",
);

const covenCodeBat = path.join(covenCodeShimDir, "coven-code.bat");
await writeFile(
  covenCodeBat,
  '"%~dp0\\node_modules\\@opencoven\\coven-code\\bin\\coven-code" %*\r\n',
);
assert.deepEqual(
  covenLaunchCommandForBinary(covenCodeBat, "win32"),
  { command: process.execPath, fixedArgs: [covenCodeShimScript] },
  "Windows .bat shims and the %~dp0 batch form resolve the same extensionless target",
);

assert.deepEqual(
  covenLaunchCommandForBinary("C:\\tools\\coven.exe", "win32"),
  { command: "C:\\tools\\coven.exe", fixedArgs: [] },
  "Windows native executables remain direct launch commands",
);

const unresolvedShimDir = await mkdtemp(path.join(os.tmpdir(), "coven-unresolved-shim-"));
// A real CLI script alongside an unparseable shim must not become a fallback:
// doing that is how a coven-code probe used to report Coven CLI's version.
const wrongPackageScript = path.join(unresolvedShimDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
await mkdir(path.dirname(wrongPackageScript), { recursive: true });
await writeFile(wrongPackageScript, "console.log('wrong package');\n");
const unresolvedShim = path.join(unresolvedShimDir, "coven-code.cmd");
await writeFile(unresolvedShim, "@ECHO off\r\nREM unknown shim shape\r\n");

assert.deepEqual(
  covenLaunchCommandForBinary(unresolvedShim, "win32"),
  { command: unresolvedShim, fixedArgs: [], unresolvedWindowsShim: true },
  "unparseable Windows shims report an unknown target instead of falling back to another package",
);

const missingShim = path.join(unresolvedShimDir, "missing.cmd");
assert.deepEqual(
  covenLaunchCommandForBinary(missingShim, "win32"),
  { command: missingShim, fixedArgs: [], unresolvedWindowsShim: true },
  "missing Windows shims retain their path but have an explicit unknown target",
);

// Windows has no $SHELL, so the login-shell PATH probe always failed there
// and refreshCovenSpawnEnv() could never see PATH entries added after launch
// (e.g. npm's global dir right after the onboarding installer runs). The
// registry is where those entries actually land.
assert.match(
  source,
  /process\.platform === "win32"\s*\?\s*windowsRegistryPath\(\)\s*:\s*loginShellPath\(\)/,
  "Windows spawn PATH comes from the registry, not a POSIX login-shell probe",
);

assert.match(
  source,
  /HKLM\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\Session Manager\\\\Environment[\s\S]*HKCU\\\\Environment/,
  "registry PATH merges the machine hive before the user hive, matching Windows' own order",
);

const regExpandOutput = [
  "",
  "HKEY_CURRENT_USER\\Environment",
  "    Path    REG_EXPAND_SZ    %USERPROFILE%\\go\\bin;C:\\Program Files\\Git\\cmd;%COVEN_UNSET%\\bin",
  "",
].join("\r\n");

assert.equal(
  windowsPathFromRegQuery(regExpandOutput, { USERPROFILE: "C:\\Users\\annie" }),
  "C:\\Users\\annie\\go\\bin;C:\\Program Files\\Git\\cmd;%COVEN_UNSET%\\bin",
  "REG_EXPAND_SZ values expand %VAR% and leave unknown variables intact, like Windows does",
);

assert.equal(
  windowsPathFromRegQuery(regExpandOutput, { UserProfile: "C:\\Users\\annie" }),
  "C:\\Users\\annie\\go\\bin;C:\\Program Files\\Git\\cmd;%COVEN_UNSET%\\bin",
  "%VAR% expansion is case-insensitive, like Windows env lookup",
);

assert.equal(
  windowsPathFromRegQuery(
    "HKEY_CURRENT_USER\\Environment\r\n    PATH    REG_SZ    %USERPROFILE%\\bin;C:\\tools\r\n",
    { USERPROFILE: "C:\\Users\\annie" },
  ),
  "%USERPROFILE%\\bin;C:\\tools",
  "REG_SZ values are returned verbatim (Windows does not expand them either)",
);

assert.equal(
  windowsPathFromRegQuery(
    "ERROR: The system was unable to find the specified registry key or value.",
  ),
  null,
  "missing Path value yields null so the other hive still contributes",
);

// `where` lists npm's extensionless POSIX launcher before the .cmd shim, and
// a bare Windows spawn can only execute .exe/.com — so the picker must
// prefer real launchers or spawn("coven") ENOENTs with the CLI on PATH.
assert.equal(
  pickWindowsLauncher(["C:\\node\\coven", "C:\\node\\coven.cmd", "C:\\shims\\coven.exe"]),
  "C:\\node\\coven.cmd",
  "the first spawnable launcher preserves PATH precedence over a later .exe",
);

assert.equal(
  pickWindowsLauncher(["C:\\node\\coven", "C:\\node\\coven.cmd"]),
  "C:\\node\\coven.cmd",
  "npm's .cmd shim wins over the unspawnable extensionless launcher",
);

assert.equal(
  pickWindowsLauncher(["C:\\node\\coven.CMD"]),
  "C:\\node\\coven.CMD",
  "extension matching is case-insensitive",
);

assert.equal(
  pickWindowsLauncher(["", "  ", "C:\\node\\coven", ""]),
  "C:\\node\\coven",
  "falls back to the first non-blank entry when nothing spawnable exists",
);

assert.equal(pickWindowsLauncher([]), null, "empty `where` output yields null");

assert.match(
  source,
  /execFileSync\("where", \["coven"\][\s\S]*pickWindowsLauncher/,
  "covenBin falls back to `where` + launcher picking before the literal name on Windows",
);

// Released Coven CLIs only auto-trust recipe-installed manifests inside
// COVEN_HOME/adapters (hermes); Cave-scaffolded copilot/opencode manifests
// there are ignored unless COVEN_HARNESS_ADAPTER_DIRS names the directory.
// Every coven spawn must therefore carry the env var.
const defaultAdapters = path.join(os.homedir(), ".coven", "adapters");
assert.equal(
  covenAdapterDirsEnvValue(undefined),
  defaultAdapters,
  "no user value → COVEN_HOME defaults to ~/.coven and adapters/ is named",
);
assert.equal(
  covenAdapterDirsEnvValue(undefined, path.join(os.tmpdir(), "coven-home")),
  path.join(os.tmpdir(), "coven-home", "adapters"),
  "an explicit COVEN_HOME override wins over ~/.coven",
);
assert.equal(
  covenAdapterDirsEnvValue("/opt/adapters"),
  ["/opt/adapters", defaultAdapters].join(path.delimiter),
  "a user-set value keeps priority; Cave's directory is appended",
);
assert.equal(
  covenAdapterDirsEnvValue(defaultAdapters),
  defaultAdapters,
  "already-listed directory is not duplicated (dup adapter ids error in the CLI)",
);
assert.match(
  source,
  /COVEN_HARNESS_ADAPTER_DIRS = covenAdapterDirsEnvValue\(/,
  "covenSpawnEnv wires the adapter dirs into every coven child process",
);

assert.match(
  source,
  /env\.NPM_CONFIG_LOGLEVEL = "error"/,
  "covenSpawnEnv quiets npm warn-level 'Unknown env config' noise in spawned installs",
);

console.log("coven-bin.test.ts: ok");
