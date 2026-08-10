// @ts-nocheck
// Windows npm installs create command shims in %APPDATA%\npm and expose
// executables through semicolon-delimited PATH entries. Cave must preserve
// that shape when launched as a desktop app, otherwise /api/onboarding/status
// can find `coven` while later spawns still fail with ENOENT.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV, caveToolSpawnEnv, covenAdapterDirsEnvValue, covenBinaryFromEnvironment, covenLaunchCommandForBinary, covenSpawnEnv, covenWrapperSpawnEnv, pickWindowsLauncher, refreshCovenSpawnEnv, runnableNodeToolchainDirs, scrubSidecarInternalEnv, windowsPathFromRegQuery, withCovenWrapperWindowPolicy } from "./coven-bin.ts";
import { harnessSpawnEnv } from "./harness-spawn-env.ts";

const source = await readFile(new URL("./coven-bin.ts", import.meta.url), "utf8");
const childSpawnEnvSource = await readFile(
  new URL("./child-spawn-env.ts", import.meta.url),
  "utf8",
);

assert.equal(
  withCovenWrapperWindowPolicy({}, "win32")[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
  "1",
  "every Cave-owned Coven wrapper invocation opts into hidden native Windows children",
);
assert.equal(
  withCovenWrapperWindowPolicy(
    { [COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV]: "1" },
    "linux",
  )[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
  undefined,
  "the wrapper opt-in is Windows-only",
);
assert.deepEqual(
  withCovenWrapperWindowPolicy(
    { coven_windows_hide_native_window: "1" },
    "win32",
    false,
  ),
  {},
  "user-selected project tools never inherit Cave's wrapper window policy",
);
assert.equal(
  covenWrapperSpawnEnv({}, "win32")[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
  "1",
  "the semantic helper opts one exact Coven wrapper launch into native window suppression",
);

{
  const previous = process.env[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV];
  process.env[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV] = "inherited";
  try {
    refreshCovenSpawnEnv({ discoveryDeadline: 0, now: () => 0 });
    assert.equal(
      covenSpawnEnv()[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
      undefined,
      "the generic Coven-derived environment scrubs an inherited wrapper signal",
    );
    assert.equal(
      harnessSpawnEnv()[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
      undefined,
      "direct harnesses never inherit the Coven-wrapper-only signal",
    );
    assert.equal(
      caveToolSpawnEnv()[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
      undefined,
      "project tools never inherit the Coven-wrapper-only signal",
    );
  } finally {
    if (previous === undefined) delete process.env[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV];
    else process.env[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV] = previous;
    refreshCovenSpawnEnv();
  }
}

assert.match(
  source,
  /process\.platform === "win32"[\s\S]*APPDATA[\s\S]*"npm"/,
  "Windows discovery includes the npm global shim directory under %APPDATA%\\npm",
);

{
  const previousPath = process.env.PATH;
  process.env.PATH = ["/queue-launch-path", "/usr/bin"].join(path.delimiter);
  refreshCovenSpawnEnv();
  assert.equal(
    caveToolSpawnEnv().PATH?.split(path.delimiter)[0],
    "/queue-launch-path",
    "Queue tools preserve the desktop launch PATH before Cave fallback directories",
  );
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  refreshCovenSpawnEnv();
}

if (process.platform !== "win32") {
  const vaultDiscoveryDir = await mkdtemp(path.join(os.tmpdir(), "coven-bin-vault-free-"));
  const fakeHome = path.join(vaultDiscoveryDir, "home");
  const fakeBin = path.join(fakeHome, ".nvm", "versions", "node", "v99.0.0", "bin");
  const captureFile = path.join(vaultDiscoveryDir, "probe-env.txt");
  const vaultFile = path.join(vaultDiscoveryDir, "vault.yaml");
  const originalEnv = {
    HOME: process.env.HOME,
    COVEN_BIN: process.env.COVEN_BIN,
    COVEN_VAULT_FILE: process.env.COVEN_VAULT_FILE,
    COVEN_TEST_CAPTURE_FILE: process.env.COVEN_TEST_CAPTURE_FILE,
    COVEN_TEST_NON_GITHUB_SECRET: process.env.COVEN_TEST_NON_GITHUB_SECRET,
  };
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    path.join(fakeBin, "node"),
    [
      "#!/bin/sh",
      'printf \'node:%s\\n\' "${COVEN_TEST_NON_GITHUB_SECRET-unset}" >> "$COVEN_TEST_CAPTURE_FILE"',
    ].join("\n"),
  );
  await writeFile(
    path.join(fakeBin, "npm"),
    [
      "#!/bin/sh",
      'printf \'npm:%s\\n\' "${COVEN_TEST_NON_GITHUB_SECRET-unset}" >> "$COVEN_TEST_CAPTURE_FILE"',
    ].join("\n"),
  );
  await writeFile(path.join(fakeBin, "coven"), "#!/bin/sh\nexit 0\n");
  await Promise.all([
    chmod(path.join(fakeBin, "node"), 0o755),
    chmod(path.join(fakeBin, "npm"), 0o755),
    chmod(path.join(fakeBin, "coven"), 0o755),
  ]);
  await writeFile(
    vaultFile,
    'COVEN_TEST_NON_GITHUB_SECRET:\n  ref: "op://Test/Secret/value"\n',
  );
  process.env.HOME = fakeHome;
  delete process.env.COVEN_BIN;
  process.env.COVEN_VAULT_FILE = vaultFile;
  process.env.COVEN_TEST_CAPTURE_FILE = captureFile;
  process.env.COVEN_TEST_NON_GITHUB_SECRET = "non-github-vault-secret";
  try {
    const isolatedCovenBin = await import(`./coven-bin.ts?vault-free=${Date.now()}`);
    assert.equal(
      isolatedCovenBin.covenBin(),
      path.join(fakeBin, "coven"),
      "the isolated default binary discovery exercises the fake NVM toolchain",
    );
    assert.equal(
      await readFile(captureFile, "utf8"),
      "node:unset\nnpm:unset\n",
      "default covenBin Node/npm discovery removes non-GitHub Vault-mapped credentials",
    );
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(vaultDiscoveryDir, { recursive: true, force: true });
  }
}

{
  const expiredPath = path.join(os.tmpdir(), "coven-expired-discovery");
  const healthyPath = path.join(os.tmpdir(), "coven-healthy-discovery");
  const baseDiscoveryEnv = {
    ...process.env,
    SHELL: path.join(os.tmpdir(), "missing-coven-discovery-shell"),
  };
  try {
    const expired = refreshCovenSpawnEnv({
      discoveryEnv: { ...baseDiscoveryEnv, PATH: expiredPath },
      discoveryDeadline: 1_000,
      now: () => 1_000,
    });
    const healthy = covenSpawnEnv({
      discoveryEnv: { ...baseDiscoveryEnv, PATH: healthyPath },
      discoveryDeadline: 10_000,
      now: () => 2_000,
    });
    assert.notEqual(
      healthy.PATH,
      expired.PATH,
      "an expired cold discovery result is returned once but not cached",
    );
    assert.ok(
      healthy.PATH?.split(path.delimiter).includes(healthyPath),
      "the next call rebuilds PATH from its healthy discovery snapshot",
    );
    assert.equal(
      healthy.PATH?.split(path.delimiter).includes(expiredPath),
      false,
      "the incomplete first PATH does not poison the canonical cache",
    );
  } finally {
    refreshCovenSpawnEnv();
  }
}

assert.match(
  source,
  /path\.join\([^\n]*HOME, "\.grok", "bin"\)/,
  "spawn PATH includes Grok Build's official ~/.grok/bin install location on macOS, Linux, and Windows",
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
  childSpawnEnvSource,
  /FORBIDDEN_SPAWN_ENV_KEYS = \[[\s\S]*"GITHUB_PAT",[\s\S]*"GITHUB_TOKEN",[\s\S]*"COVEN_GITHUB_TOKEN",[\s\S]*"GH_TOKEN",[\s\S]*"GITHUB_PERSONAL_ACCESS_TOKEN"/,
  "coven child processes strip every GitHub credential alias Cave accepts",
);

// ── cave-o01k: sidecar-internal env never reaches children ────────────────────
// Packaged-app children inherited __NEXT_PRIVATE_STANDALONE_CONFIG (breaks any
// `next build`/dev server a session runs — the JSON config has no
// generateBuildId function and bakes CI paths) and COVEN_CAVE_* auth/bundle
// state (401-gates an inherited dev server; the tokens are secrets).
assert.match(
  childSpawnEnvSource,
  /SIDECAR_INTERNAL_ENV_PREFIXES = \["COVEN_CAVE_", "__NEXT_PRIVATE_"\]/,
  "the sidecar-internal namespaces are scrubbed by prefix, so new COVEN_CAVE_* vars stay contained",
);
assert.match(
  source,
  /return withCovenWrapperWindowPolicy\(\s*scrubSidecarInternalEnv\(env\),[\s\S]*process\.platform,[\s\S]*false,[\s\S]*\);/,
  "the shared spawn baseline scrubs the wrapper-only Windows signal",
);
assert.match(
  source,
  /export function covenWrapperSpawnEnv\([\s\S]*return withCovenWrapperWindowPolicy\(env, platform, true\)/,
  "only the exact Coven wrapper helper restores the Windows no-window opt-in",
);
{
  const env = scrubSidecarInternalEnv({
    PATH: "/usr/bin",
    HOME: "/Users/witch",
    SHELL: "/bin/zsh",
    COVEN_CAVE_BUNDLE: "1",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret",
    COVEN_CAVE_ACCESS_TOKEN: "mobile-secret",
    COVEN_CAVE_PTY_DETACH_GRACE_MS: "1000",
    __NEXT_PRIVATE_STANDALONE_CONFIG: "{\"distDir\":\"/Users/runner/work\"}",
    __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000",
    GITHUB_PAT: "ghp_x",
    GITHUB_TOKEN: "github-token",
    COVEN_GITHUB_TOKEN: "coven-github-token",
    GH_TOKEN: "gh-token",
    GITHUB_PERSONAL_ACCESS_TOKEN: "marketplace-token",
    NODE_OPTIONS: "--require=attacker.cjs",
    NPM_CONFIG_NODE_OPTIONS: "--require=attacker.cjs",
    COVEN_BIN: "/tmp/attacker-bin",
    COVEN_VAULT_FILE: "/tmp/attacker-vault.yaml",
    MY_APP_TOKEN: "kept",
  });
  assert.deepEqual(
    env,
    {
      PATH: "/usr/bin",
      HOME: "/Users/witch",
      SHELL: "/bin/zsh",
      MY_APP_TOKEN: "kept",
    },
    "scrubSidecarInternalEnv drops sidecar secrets and runtime-control keys while keeping the user environment intact",
  );
}
{
  const env = scrubSidecarInternalEnv({
    PATH: "C:\\Windows\\System32",
    HOME: "C:\\Users\\witch",
    CoVeN_CaVe_Auth_Token: "sidecar-mixed-case-secret",
    __next_private_origin: "next-mixed-case-secret",
    GitHub_Pat: "ghp_mixed_case",
    Node_Options: "--require=attacker.cjs",
    Npm_Config_Node_Options: "--require=attacker.cjs",
    Coven_Bin: "C:\\attacker\\coven.exe",
    Coven_Vault_File: "C:\\attacker\\vault.yaml",
    MY_APP_TOKEN: "kept",
  }, "win32");
  assert.deepEqual(
    env,
    {
      PATH: "C:\\Windows\\System32",
      HOME: "C:\\Users\\witch",
      MY_APP_TOKEN: "kept",
    },
    "Windows scrubbing compares internal, credential, and runtime-control keys case-insensitively",
  );
}
// Every other spawn site that spreads process.env wraps it in the scrub —
// gh/bd/npx/tailscale/vault children run user-visible (or arbitrary,
// via npx postinstall) code and must not see sidecar secrets either.
for (const rel of [
  "../app/api/skills/directory/install/route.ts",
  "../app/api/skills/directory/use/route.ts",
  "./branch-pr-context.ts",
  "./mobile-handoff.ts",
  "./vault.ts",
]) {
  const spawnSite = await readFile(new URL(rel, import.meta.url), "utf8");
  assert.match(
    spawnSite,
    /scrubSidecarInternalEnv\(\{\s*\.\.\.process\.env/,
    `${rel} scrubs sidecar-internal env before spawning`,
  );
  assert.doesNotMatch(
    spawnSite,
    /env: \{ \.\.\.process\.env/,
    `${rel} has no unscrubbed process.env spread left`,
  );
}

// Queue subprocesses must use the same login-shell PATH as onboarding. A
// packaged Finder/Spotlight launch otherwise finds Git during setup but loses
// git/bd/gh when Queue performs its own repository work.
for (const rel of [
  "../app/api/beads/prs/route.ts",
  "./server/beads-cli.ts",
  "./server/issue-worktree-provision.ts",
  "./queue-project-readiness.ts",
]) {
  const spawnSite = await readFile(new URL(rel, import.meta.url), "utf8");
  assert.match(spawnSite, /caveToolSpawnEnv\(\)/, `${rel} uses Cave's augmented, scrubbed launch PATH`);
}

assert.match(
  source,
  /export function refreshCovenSpawnEnv\([^)]*CovenSpawnEnvOptions[\s\S]*cachedPath = null[\s\S]*return covenSpawnEnv\(options\)/,
  "desktop install retries can refresh Cave's cached PATH after Node/npm is installed",
);

// A newer version-manager directory can remain after its runtime becomes
// unusable. It must not shadow the healthy Node/npm pair that the user's
// ordinary shell would otherwise resolve.
{
  const broken = path.join("/virtual", "nvm", "v25.9.0", "bin");
  const healthy = path.join("/virtual", "nvm", "v24.15.0", "bin");
  const brokenNpm = path.join("/virtual", "nvm", "v24.14.0", "bin");
  const missingNpm = path.join("/virtual", "nvm", "v23.0.0", "bin");
  const existing = new Set([
    path.join(broken, "node"),
    path.join(broken, "npm"),
    path.join(healthy, "node"),
    path.join(healthy, "npm"),
    path.join(brokenNpm, "node"),
    path.join(brokenNpm, "npm"),
    path.join(missingNpm, "node"),
  ]);
  const probed: string[] = [];
  const runnable = runnableNodeToolchainDirs(
    [broken, healthy, brokenNpm, missingNpm],
    {
      platform: "linux",
      exists: (file) => existing.has(file),
      probe: (command) => {
        probed.push(command);
        if (command === path.join(broken, "node")) {
          throw new Error("error while loading shared libraries: libatomic.so.1");
        }
        if (command === path.join(brokenNpm, "npm")) {
          throw new Error("npm launcher failed");
        }
      },
    },
  );
  assert.deepEqual(runnable, [healthy], "only a runnable Node directory with npm survives");
  assert.deepEqual(
    probed,
    [
      path.join(broken, "node"),
      path.join(healthy, "node"),
      path.join(healthy, "npm"),
      path.join(brokenNpm, "node"),
      path.join(brokenNpm, "npm"),
    ],
    "both launchers are probed and missing npm is rejected before attempting Node",
  );
}

{
  const windowsDir = path.join("/virtual", "fnm", "v24.15.0", "bin");
  const existing = new Set([
    path.join(windowsDir, "node.exe"),
    path.join(windowsDir, "npm.cmd"),
  ]);
  const calls: Array<{ command: string; shell?: boolean }> = [];
  const runnable = runnableNodeToolchainDirs([windowsDir], {
    platform: "win32",
    exists: (file) => existing.has(file),
    probe: (command, _args, options) => calls.push({ command, shell: options.shell }),
  });
  assert.deepEqual(runnable, [windowsDir], "a healthy Windows Node/npm toolchain survives");
  assert.deepEqual(calls, [
    { command: path.join(windowsDir, "node.exe"), shell: undefined },
    { command: path.join(windowsDir, "npm.cmd"), shell: true },
  ], "Windows npm.cmd is health-checked through its supported shell launch path");
}

{
  const secretDir = path.join("/virtual", "nvm", "v24.16.0", "bin");
  const existing = new Set([path.join(secretDir, "node"), path.join(secretDir, "npm")]);
  const originalSecretEnv = {
    COVEN_CAVE_AUTH_TOKEN: process.env.COVEN_CAVE_AUTH_TOKEN,
    __NEXT_PRIVATE_ORIGIN: process.env.__NEXT_PRIVATE_ORIGIN,
    GITHUB_PAT: process.env.GITHUB_PAT,
  };
  process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-auth-secret";
  process.env.__NEXT_PRIVATE_ORIGIN = "http://sidecar.internal";
  process.env.GITHUB_PAT = "ghp_forbidden_secret";
  try {
    const probeEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
    const runnable = runnableNodeToolchainDirs([secretDir], {
      platform: "linux",
      exists: (file) => existing.has(file),
      probe: (_command, _args, options) => probeEnvs.push(options.env),
    });
    assert.deepEqual(runnable, [secretDir], "a healthy toolchain still survives");
    assert.equal(probeEnvs.length, 2, "both node and npm probes receive explicit env");
    for (const env of probeEnvs) {
      assert.ok(env, "probe env is provided instead of inheriting process.env");
      assert.equal(env.COVEN_CAVE_AUTH_TOKEN, undefined, "node/npm probes do not receive sidecar auth tokens");
      assert.equal(env.__NEXT_PRIVATE_ORIGIN, undefined, "node/npm probes do not receive Next private env");
      assert.equal(env.GITHUB_PAT, undefined, "node/npm probes do not receive forbidden GitHub token keys");
      assert.match(env.PATH ?? "", new RegExp(`^${secretDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "probe PATH still prioritizes the candidate directory");
    }
  } finally {
    for (const [key, value] of Object.entries(originalSecretEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

{
  const discoveryDir = path.join("/virtual", "nvm", "v24.17.0", "bin");
  const existing = new Set([
    path.join(discoveryDir, "node"),
    path.join(discoveryDir, "npm"),
  ]);
  const originalVaultSentinel = process.env.COVEN_TEST_VAULT_SENTINEL;
  const originalSidecarSentinel = process.env.COVEN_CAVE_TEST_DISCOVERY_SENTINEL;
  process.env.COVEN_TEST_VAULT_SENTINEL = "vault-secret";
  process.env.COVEN_CAVE_TEST_DISCOVERY_SENTINEL = "sidecar-secret";
  try {
    const explicitDiscoveryEnv = {
      PATH: "/credential-free/discovery-path",
      UNRELATED_DISCOVERY_VALUE: "keep",
    };
    const probeEnvs: NodeJS.ProcessEnv[] = [];
    const runnable = runnableNodeToolchainDirs([discoveryDir], {
      platform: "linux",
      exists: (file) => existing.has(file),
      env: explicitDiscoveryEnv,
      deadline: 2_000,
      now: () => 1_000,
      probe: (_command, _args, options) => {
        assert.ok(options.env, "each discovery probe receives an explicit env");
        probeEnvs.push(options.env);
      },
    });
    assert.deepEqual(runnable, [discoveryDir]);
    assert.equal(probeEnvs.length, 2, "both Node and npm receive the discovery env");
    for (const env of probeEnvs) {
      assert.equal(
        env.COVEN_TEST_VAULT_SENTINEL,
        undefined,
        "an explicit vault-free env never falls back to secretful process.env",
      );
      assert.equal(
        env.COVEN_CAVE_TEST_DISCOVERY_SENTINEL,
        undefined,
        "sidecar credentials remain absent during toolchain discovery",
      );
      assert.equal(env.UNRELATED_DISCOVERY_VALUE, "keep");
      assert.equal(
        env.PATH?.split(path.delimiter)[0],
        discoveryDir,
        "the candidate toolchain remains first on discovery PATH",
      );
    }
  } finally {
    if (originalVaultSentinel === undefined) delete process.env.COVEN_TEST_VAULT_SENTINEL;
    else process.env.COVEN_TEST_VAULT_SENTINEL = originalVaultSentinel;
    if (originalSidecarSentinel === undefined) {
      delete process.env.COVEN_CAVE_TEST_DISCOVERY_SENTINEL;
    } else {
      process.env.COVEN_CAVE_TEST_DISCOVERY_SENTINEL = originalSidecarSentinel;
    }
  }
}

{
  const expiredDir = path.join("/virtual", "nvm", "v24.18.0", "bin");
  const existing = new Set([
    path.join(expiredDir, "node"),
    path.join(expiredDir, "npm"),
  ]);
  const probes: string[] = [];
  const runnable = runnableNodeToolchainDirs([expiredDir], {
    platform: "linux",
    exists: (file) => existing.has(file),
    env: { PATH: "/discovery" },
    deadline: 5_000,
    now: () => 5_000,
    probe: (command) => probes.push(command),
  });
  assert.deepEqual(runnable, [], "an expired discovery budget cannot admit a toolchain");
  assert.deepEqual(probes, [], "an expired discovery budget starts no helper");
}

{
  const interruptedDir = path.join("/virtual", "nvm", "v24.19.0", "bin");
  const existing = new Set([
    path.join(interruptedDir, "node"),
    path.join(interruptedDir, "npm"),
  ]);
  let clock = 7_000;
  const probes: string[] = [];
  const runnable = runnableNodeToolchainDirs([interruptedDir], {
    platform: "linux",
    exists: (file) => existing.has(file),
    env: { PATH: "/discovery" },
    deadline: 7_100,
    now: () => clock,
    probe: (command) => {
      probes.push(command);
      clock = 7_100;
    },
  });
  assert.deepEqual(
    runnable,
    [],
    "a directory is not admitted when Node consumes the remaining discovery budget",
  );
  assert.deepEqual(
    probes,
    [path.join(interruptedDir, "node")],
    "remaining time is re-checked before starting npm",
  );
}

{
  const expiredAfterNpmDir = path.join("/virtual", "nvm", "v24.20.0", "bin");
  const existing = new Set([
    path.join(expiredAfterNpmDir, "node"),
    path.join(expiredAfterNpmDir, "npm"),
  ]);
  let clock = 8_000;
  const runnable = runnableNodeToolchainDirs([expiredAfterNpmDir], {
    platform: "linux",
    exists: (file) => existing.has(file),
    env: { PATH: "/discovery" },
    deadline: 8_100,
    now: () => clock,
    probe: (command) => {
      if (command === path.join(expiredAfterNpmDir, "npm")) clock = 8_100;
    },
  });
  assert.deepEqual(
    runnable,
    [],
    "a directory is not admitted when npm consumes the remaining discovery budget",
  );
}

assert.match(
  source,
  /function nodeNvmBinDirs\([^)]*\)[\s\S]*return runnableNodeToolchainDirs\(directories, \{[\s\S]*env: discovery\.env[\s\S]*deadline: discovery\.deadline/,
  "NVM candidates are health-checked with the bounded discovery context before Cave prepends them",
);
assert.match(
  source,
  /function fnmBinDirs\([^)]*\)[\s\S]*return runnableNodeToolchainDirs\(directories, \{[\s\S]*env: discovery\.env[\s\S]*deadline: discovery\.deadline/,
  "FNM candidates are health-checked with the bounded discovery context before Cave prepends them",
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

const nativeShimTarget = path.join(
  npmShimDir,
  "node_modules",
  "opencode-ai",
  "bin",
  "opencode.exe",
);
await mkdir(path.dirname(nativeShimTarget), { recursive: true });
await writeFile(nativeShimTarget, "native executable fixture");
const nativeShim = path.join(npmShimDir, "opencode.cmd");
await writeFile(
  nativeShim,
  '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n',
);
assert.deepEqual(
  covenLaunchCommandForBinary(nativeShim, "win32"),
  { command: nativeShimTarget, fixedArgs: [] },
  "Windows npm shims that target native executables bypass cmd.exe and preserve argv",
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
  /process\.platform === "win32"\s*\?\s*windowsRegistryPath\(discovery\)\s*:\s*loginShellPath\(discovery\)/,
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

assert.doesNotMatch(
  source,
  /execFileSync\("where(?:\.exe)?", \["coven"\]/,
  "Coven resolution never delegates to where.exe, whose search includes cwd",
);
assert.doesNotMatch(
  source,
  /execFileSync\("reg(?:\.exe)?"/,
  "Windows PATH refresh never runs a cwd-searchable registry utility",
);
assert.match(
  source,
  /path\.join\([^\n]*systemRoot, "System32", "reg\.exe"\)/,
  "Windows PATH refresh pins reg.exe to the verified system directory",
);
assert.match(
  source,
  /process\.platform === "win32"\) throw new Error\(COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC\)/,
  "a missing Windows Coven CLI fails closed instead of returning a bare executable name",
);

if (process.platform === "win32") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-coven-cwd-plant-"));
  const verifiedDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-coven-path-"));
  try {
    await copyFile(process.execPath, path.join(directory, "coven.exe"));
    await copyFile(process.execPath, path.join(verifiedDirectory, "coven.exe"));
    assert.equal(
      covenBinaryFromEnvironment({ Path: ".", COVEN_BIN: "coven.exe" }),
      null,
      "an explicit relative override and relative PATH never consult the process cwd",
    );
    assert.equal(
      covenBinaryFromEnvironment({ Path: verifiedDirectory }),
      path.join(verifiedDirectory, "coven.exe"),
      "an existing launcher in an explicit absolute PATH directory is eligible",
    );
    assert.equal(
      covenBinaryFromEnvironment({ Path: "\\\\remote-host\\share" }),
      null,
      "remote UNC search roots cannot supply Cave's owner-local Coven CLI",
    );
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH" || key === "COVEN_BIN") delete env[key];
    }
    Object.assign(env, {
      Path: ".",
      COVEN_BIN: "coven.exe",
      HOME: directory,
      USERPROFILE: directory,
      APPDATA: path.join(directory, "appdata"),
      LOCALAPPDATA: path.join(directory, "localappdata"),
    });
    const moduleHref = new URL(`./coven-bin.ts?cwd-plant=${Date.now()}`, import.meta.url).href;
    const probe = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { covenBin } from ${JSON.stringify(moduleHref)}; try { console.log(covenBin()); } catch (error) { console.error(error.message); }`,
      ],
      { cwd: directory, env, encoding: "utf8", windowsHide: true, shell: false },
    );
    assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
    const selected = probe.stdout.trim();
    assert.ok(
      selected || /Coven CLI was not found/i.test(probe.stderr),
      "discovery either selects a verified system/user installation or fails closed",
    );
    assert.notEqual(
      selected.toLowerCase(),
      path.join(directory, "coven.exe").toLowerCase(),
      "neither Windows cwd search nor a relative override can select cwd-planted coven.exe",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(verifiedDirectory, { recursive: true, force: true });
  }
}

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
