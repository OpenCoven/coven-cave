// @ts-nocheck
import assert from "node:assert/strict";
import { isOpenCodeLaunchSpawnable, openCodeAvailabilityProbe, openCodeCommand, openCodeLaunch, openCodeNeedsTmpRuntimeDir, preferOpenCodeLaunchPath } from "./opencode-bin.ts";
import { evaluateRuntimeAvailability, missingRunnerMessage } from "./runtime-availability.ts";

assert.equal(openCodeCommand(), "opencode", "OpenCode uses the same executable name on all desktop platforms");

const statOnly = (...present: string[]) => (candidate: string) => present.includes(candidate);

const linuxLaunch = openCodeLaunch(["run", "--format", "json", "safe & literal"], "linux");
assert.deepEqual(linuxLaunch, {
  command: "opencode",
  args: ["run", "--format", "json", "safe & literal"],
}, "POSIX launches OpenCode directly");

const winEnv = { PATH: "C:\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
const npmShim = "C:\\npm\\opencode.cmd";
const nativeTarget = "C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe";
const windowsLaunch = openCodeLaunch(
  ["run", "safe & literal", "percent%PATH%"],
  "win32",
  winEnv,
  {
    statFile: statOnly(npmShim),
    resolveWindowsShim: (candidate) => {
      assert.equal(candidate, npmShim, "the resolver receives the PATH-winning npm shim");
      return { command: nativeTarget, fixedArgs: [] };
    },
  },
);
assert.deepEqual(
  windowsLaunch,
  {
    command: nativeTarget,
    args: ["run", "safe & literal", "percent%PATH%"],
  },
  "Windows resolves the npm shim to its native package target and forwards argv without a shell",
);
assert.doesNotMatch(
  windowsLaunch.command,
  /\.(?:cmd|bat|ps1)$/i,
  "Windows never executes a shim that can reparse prompt-bearing argv",
);
assert.equal(
  isOpenCodeLaunchSpawnable(windowsLaunch),
  true,
  "a proven shell-free target is safe for non-chat OpenCode probes to spawn",
);

const legacyTarget = "C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.js";
const legacyLaunch = openCodeLaunch(["run", "quoted \"data\""], "win32", winEnv, {
  statFile: statOnly(npmShim),
  resolveWindowsShim: () => ({ command: process.execPath, fixedArgs: [legacyTarget] }),
});
assert.deepEqual(
  legacyLaunch,
  {
    command: process.execPath,
    args: [legacyTarget, "run", "quoted \"data\""],
    requiredFiles: [legacyTarget],
  },
  "a legacy Node-target npm shim becomes a direct node + script plan whose fixed target is preflighted",
);

const unsafePowerShellOnly = openCodeLaunch(["run", "hello"], "win32", winEnv, {
  statFile: statOnly("C:\\npm\\opencode.ps1"),
});
assert.equal(
  unsafePowerShellOnly.unresolvedWindowsShim,
  true,
  "a PowerShell-only install is explicit unlaunchable state instead of a lossy argv boundary",
);
assert.equal(
  isOpenCodeLaunchSpawnable(unsafePowerShellOnly),
  false,
  "an unresolved Windows shim cannot be spawned by capability or model probes",
);

const failedResolution = openCodeLaunch(["run", "hello"], "win32", winEnv, {
  statFile: () => {
    throw Object.assign(new Error("EACCES"), { code: "EACCES" });
  },
});
assert.equal(
  failedResolution.resolutionFailed,
  true,
  "a PATH inspection failure is retained for probe_failed classification",
);
assert.equal(
  isOpenCodeLaunchSpawnable(failedResolution),
  false,
  "a failed resolver cannot fall through to an accidental PATH launch",
);

assert.equal(openCodeNeedsTmpRuntimeDir("win32", {}), false, "Windows does not use XDG_RUNTIME_DIR");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", {}), true, "headless Linux receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), false, "native Linux preserves a valid runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { WSL_DISTRO_NAME: "Ubuntu", XDG_RUNTIME_DIR: "/run/user/1000" }), true, "WSL replaces a stale inherited runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", {}), true, "headless macOS receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", { XDG_RUNTIME_DIR: "/var/folders/runtime" }), false, "native macOS preserves a valid runtime directory");


assert.equal(
  preferOpenCodeLaunchPath("C:\\older;C:\\fallback", "C:\\fresh;C:\\older", "win32"),
  "C:\\fresh;C:\\older;C:\\fallback",
  "OpenCode keeps the user launch PATH ahead of discovered harness fallbacks",
);
assert.equal(
  preferOpenCodeLaunchPath("/fallback:/usr/bin", "/fresh:/usr/bin", "linux"),
  "/fresh:/usr/bin:/fallback",
  "POSIX launch entries retain their order while scoped fallbacks remain available",
);

// --- openCodeAvailabilityProbe (#3862): preflight the exact resolved launch plan ---

const probeFor = (args, platform, env, statFile, launchEnv = {}, launchOptions = {}) =>
  openCodeAvailabilityProbe(
    openCodeLaunch(args, platform, launchEnv, { statFile, ...launchOptions }),
    env,
    { platform, statFile },
  );

// POSIX: missing opencode is classified before any child exists, with the
// same install/PATH remediation copy every surface shares.
const posixMissing = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "linux", { PATH: "/usr/bin:/opt/tools" }, () => false),
);
assert.equal(posixMissing.state, "missing", "POSIX missing opencode is detected by the preflight");
assert.equal(posixMissing.code, "runtime_missing");
assert.equal(
  posixMissing.message,
  missingRunnerMessage("opencode"),
  "missing OpenCode remediation copy is the shared npm-install message on every surface",
);
assert.match(posixMissing.message, /npm install -g opencode-ai/, "remediation names the install command");

// POSIX: a resolvable opencode is ready, at the exact path the spawn will use.
const posixReady = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "linux", { PATH: "/usr/bin" }, statOnly("/usr/bin/opencode")),
);
assert.deepEqual(
  posixReady,
  { state: "ready", runner: "opencode", resolvedPath: "/usr/bin/opencode" },
  "POSIX preflight resolves the same bare command the direct spawn launches",
);

// Windows: no OpenCode candidate anywhere → missing, with install copy.
const winMissing = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "win32", winEnv, statOnly(), winEnv),
);
assert.equal(winMissing.state, "missing", "an absent OpenCode install is missing");
assert.equal(winMissing.message, missingRunnerMessage("opencode"));

// Windows: a cmd shim with a proven native package target becomes a direct
// launch. Availability checks that exact target without executing it.
const winReady = evaluateRuntimeAvailability(
  probeFor(
    ["run", "hello"],
    "win32",
    winEnv,
    statOnly(npmShim, nativeTarget),
    winEnv,
    {
      resolveWindowsShim: () => ({ command: nativeTarget, fixedArgs: [] }),
    },
  ),
);
assert.deepEqual(
  winReady,
  { state: "ready", runner: "opencode", resolvedPath: nativeTarget },
  "Windows preflight validates the exact native command the route will spawn",
);
const posixProbe = probeFor(["run", "hello"], "linux", { PATH: "/usr/bin" }, () => true);
assert.equal(
  posixProbe.requiredFiles,
  undefined,
  "direct POSIX launches have no fixed package target",
);

const winNativeReady = evaluateRuntimeAvailability(
  probeFor(
    ["run", "hello"],
    "win32",
    winEnv,
    statOnly("C:\\npm\\opencode.exe"),
    winEnv,
  ),
);
assert.equal(winNativeReady.state, "ready", "a native OpenCode executable is a safe direct launch");

const winCmdOnly = evaluateRuntimeAvailability(
  probeFor(
    ["run", "hello"],
    "win32",
    winEnv,
    statOnly(npmShim),
    winEnv,
    {
      resolveWindowsShim: (candidate) => ({
        command: candidate,
        fixedArgs: [],
        unresolvedWindowsShim: true,
      }),
    },
  ),
);
assert.equal(
  winCmdOnly.state,
  "unlaunchable",
  "an unparseable command shim is detected but never executed with prompt-bearing argv",
);
assert.match(
  winCmdOnly.state === "unlaunchable" ? winCmdOnly.message : "",
  /launcher shim/i,
  "unparseable-shim diagnostics distinguish an unsafe launcher from an absent install",
);

// A probe that cannot stat (EACCES) is probe_failed — never "not installed".
const denied = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "linux", { PATH: "/locked" }, () => {
    throw Object.assign(new Error("EACCES: permission denied, stat '/locked/opencode'"), {
      code: "EACCES",
    });
  }),
);
assert.equal(denied.state, "probe_failed", "an unreadable PATH entry is a probe failure");
assert.equal(denied.code, "runtime_probe_failed");
assert.doesNotMatch(denied.message, /not found|npm install/, "probe failures never claim a missing install");
assert.doesNotMatch(denied.message, /\/locked/, "probe failures never leak local filesystem paths");

// The prompt is data, not a probe input: availability is identical for a
// metacharacter-laden prompt and a benign prompt on every platform.
const hostileArgs = ["run", "review this; rm -rf ~ | $(evil) && echo \"%PATH%\" > pwned <'"];
const benignArgs = ["run", "hello"];
for (const platform of ["linux", "win32"]) {
  const launchEnv = platform === "win32" ? winEnv : {};
  const env = platform === "win32" ? winEnv : { PATH: "/usr/bin" };
  const sharedStat = statOnly();
  assert.deepEqual(
    probeFor(hostileArgs, platform, env, sharedStat, launchEnv),
    probeFor(benignArgs, platform, env, sharedStat, launchEnv),
    `availability never consults the prompt (${platform})`,
  );
}
const hostileWinLaunch = openCodeLaunch(hostileArgs, "win32", winEnv);
assert.deepEqual(
  hostileWinLaunch.args,
  hostileArgs,
  "preflighted Windows launches retain hostile argv as child-process data",
);

// XDG_RUNTIME_DIR preparation and executable resolution are independent: a
// prepared runtime dir cannot mask a missing CLI, and an absent one cannot
// fail a present CLI. The probe env is the exact spawn env object, so the
// gate sees openCodeSpawnEnv()'s /tmp composition verbatim.
const xdgPrepared = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "linux", { PATH: "/usr/bin", XDG_RUNTIME_DIR: "/tmp" }, () => false),
);
assert.equal(xdgPrepared.state, "missing", "a prepared XDG runtime dir cannot masquerade as an installed CLI");
const xdgAbsent = evaluateRuntimeAvailability(
  probeFor(["run", "hello"], "linux", { PATH: "/usr/bin" }, statOnly("/usr/bin/opencode")),
);
assert.equal(xdgAbsent.state, "ready", "XDG runtime setup is not an availability input");
const spawnEnvObject = { PATH: "/usr/bin", XDG_RUNTIME_DIR: "/tmp" };
assert.equal(
  openCodeAvailabilityProbe(openCodeLaunch(["run", "hello"], "linux"), spawnEnvObject).env,
  spawnEnvObject,
  "the probe evaluates the identical env object the spawn receives",
);

console.log("opencode-bin.test.ts: ok");
