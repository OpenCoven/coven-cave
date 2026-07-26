import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  evaluateCovenBackedRuntimeAvailability,
  evaluateRuntimeAvailability,
  localRuntimeLaunchError,
  missingRunnerMessage,
  resolveHermesLaunch,
  runtimeProcessFailure,
  runtimeLaunchFailedMessage,
  summarizeRuntimeAvailability,
  RUNTIME_AVAILABILITY_ERROR_CODES,
} from "./runtime-availability.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "runtime-availability-"));
try {
  assert.deepEqual(
    localRuntimeLaunchError("grok", "ENOENT"),
    {
      code: "runtime_missing",
      message: missingRunnerMessage("grok"),
    },
    "a post-spawn missing-interpreter race retains the missing-runner contract",
  );
  assert.deepEqual(
    localRuntimeLaunchError("grok", "UNKNOWN"),
    {
      code: "runtime_launch_failed",
      message: runtimeLaunchFailedMessage("grok"),
    },
    "every non-ENOENT local spawn error uses the normalized launch-failure contract",
  );

  const binDir = path.join(scratch, "bin");
  const emptyDir = path.join(scratch, "empty");
  mkdirSync(binDir);
  mkdirSync(emptyDir);
  const nativePlatform = process.platform;
  const nativeGrok = nativePlatform === "win32" ? "grok.exe" : "grok";
  const executable = path.join(binDir, nativeGrok);
  writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
  chmodSync(executable, 0o755);
  // Verification matrix: binary resolves in the spawn env → ready.
  const ready = evaluateRuntimeAvailability({
    runner: "grok",
    command: nativeGrok,
    env: { PATH: [emptyDir, binDir].join(path.delimiter) },
    platform: nativePlatform,
  });
  assert.equal(ready.state, "ready", "a bare command on the spawn PATH is ready");
  assert.match(
    String(ready.state === "ready" && ready.resolvedPath),
    /(?:^|[\\/])grok(?:\.exe)?$/,
    "ready reports the exact executable name selected from the spawn PATH",
  );

  const linuxBinDir = "/runtime-availability/bin";
  const linuxClaudeDir = "/runtime-availability/claude-bin";
  const linuxFiles = new Set([
    path.posix.join(linuxBinDir, "coven"),
    path.posix.join(linuxClaudeDir, "claude"),
  ]);
  const linuxStat = (candidate: string) => linuxFiles.has(candidate);
  const claudeReady = evaluateCovenBackedRuntimeAvailability({
    runner: "claude",
    covenCommand: "coven",
    env: { PATH: `${linuxBinDir}:${linuxClaudeDir}` },
    platform: "linux",
    statFile: linuxStat,
  });
  assert.equal(claudeReady.state, "ready", "Claude requires both Coven and Claude to resolve");
  const claudeMissing = evaluateCovenBackedRuntimeAvailability({
    runner: "claude",
    covenCommand: "coven",
    env: { PATH: linuxBinDir },
    platform: "linux",
    statFile: linuxStat,
  });
  assert.equal(claudeMissing.state, "missing", "missing inner Claude blocks the composite launch");
  assert.equal(
    claudeMissing.state === "missing" && claudeMissing.code,
    RUNTIME_AVAILABILITY_ERROR_CODES.claude_missing,
    "a missing inner Claude has a distinct structured code",
  );
  const covenMissing = evaluateCovenBackedRuntimeAvailability({
    runner: "claude",
    covenCommand: "coven",
    env: { PATH: linuxClaudeDir },
    platform: "linux",
    statFile: linuxStat,
  });
  assert.equal(covenMissing.state, "missing", "missing outer Coven blocks the composite launch");
  assert.equal(
    covenMissing.state === "missing" && covenMissing.code,
    RUNTIME_AVAILABILITY_ERROR_CODES.coven_missing,
    "a missing outer Coven has a distinct structured code",
  );
  const absoluteReady = evaluateRuntimeAvailability({
    runner: "coven",
    command: executable,
    env: { PATH: "" },
    platform: process.platform,
  });
  assert.equal(
    absoluteReady.state,
    "ready",
    "a mode-0755 regular file is launchable on POSIX",
  );

  if (nativePlatform !== "win32") {
    const directoryCandidate = path.join(binDir, "grok-directory");
    mkdirSync(directoryCandidate);
    const directoryResult = evaluateRuntimeAvailability({
      runner: "grok",
      command: directoryCandidate,
      env: { PATH: "" },
      platform: "linux",
    });
    assert.equal(
      directoryResult.state,
      "unlaunchable",
      "an existing directory at the launch path is found but unlaunchable",
    );
    assert.equal(
      directoryResult.state === "unlaunchable" && directoryResult.code,
      RUNTIME_AVAILABILITY_ERROR_CODES.unlaunchable,
      "a non-file candidate carries runtime_unlaunchable",
    );

    const nonExecutable = path.join(binDir, "grok-no-exec");
    writeFileSync(nonExecutable, "#!/bin/sh\n", { mode: 0o644 });
    chmodSync(nonExecutable, 0o644);
    const nonExecutableResult = evaluateRuntimeAvailability({
      runner: "grok",
      command: nonExecutable,
      env: { PATH: "" },
      platform: "linux",
    });
    assert.equal(
      nonExecutableResult.state,
      "unlaunchable",
      "a mode-0644 regular file is unlaunchable on POSIX",
    );
    assert.equal(
      nonExecutableResult.state === "unlaunchable" && nonExecutableResult.code,
      RUNTIME_AVAILABILITY_ERROR_CODES.unlaunchable,
      "a non-executable regular file carries runtime_unlaunchable",
    );

    const earlierBinDir = path.join(scratch, "earlier-bin");
    mkdirSync(earlierBinDir);
    const earlierNonExecutable = path.join(earlierBinDir, "grok");
    writeFileSync(earlierNonExecutable, "#!/bin/sh\n", { mode: 0o644 });
    chmodSync(earlierNonExecutable, 0o644);
    const laterExecutableWins = evaluateRuntimeAvailability({
      runner: "grok",
      command: "grok",
      env: { PATH: `${earlierBinDir}:${binDir}` },
      platform: "linux",
    });
    assert.equal(
      laterExecutableWins.state,
      "ready",
      "a later executable PATH candidate wins after an earlier non-executable file",
    );
    assert.equal(
      laterExecutableWins.state === "ready" && laterExecutableWins.resolvedPath,
      path.posix.join(binDir, "grok"),
      "PATH resolution reports the exact later executable that won",
    );
  }

  // A direct Windows npm-shim plan is `node <entry.js>`: validating only the
  // host must not mark a removed or unreadable fixed script as ready.
  const requiredArtifactMissing = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "node.exe",
    requiredFiles: ["C:\\bin\\copilot-entry.js"],
    env: { Path: "C:\\bin" },
    platform: "win32",
    statFile: (candidate) => candidate === "C:\\bin\\node.exe",
  });
  assert.equal(requiredArtifactMissing.state, "unlaunchable");
  assert.doesNotMatch(
    requiredArtifactMissing.state === "unlaunchable" ? requiredArtifactMissing.message : "",
    /copilot-entry|C:\\bin/i,
    "required-artifact diagnostics do not expose local path details",
  );

  const requiredArtifactReady = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "node.exe",
    requiredFiles: ["C:\\bin\\copilot-entry.js"],
    env: { Path: "C:\\bin" },
    platform: "win32",
    statFile: (candidate) => candidate === "C:\\bin\\node.exe" || candidate === "C:\\bin\\copilot-entry.js",
  });
  assert.equal(requiredArtifactReady.state, "ready", "a complete direct launch plan is ready");

  const requiredArtifactUnreadable = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "node.exe",
    requiredFiles: ["C:\\bin\\copilot-entry.js"],
    env: { Path: "C:\\bin" },
    platform: "win32",
    statFile: () => true,
    readableFile: () => false,
  });
  assert.equal(
    requiredArtifactUnreadable.state,
    "unlaunchable",
    "an unreadable fixed shim entry is not safe to launch through Node",
  );

  // Verification matrix: binary absent from every discovery location →
  // missing, with per-runner install/PATH remediation.
  for (const runner of ["coven", "codex", "copilot", "grok", "hermes", "opencode"] as const) {
    const missing = evaluateRuntimeAvailability({
      runner,
      command: runner === "coven" ? "coven" : runner,
      env: { PATH: emptyDir },
      platform: nativePlatform,
    });
    assert.equal(missing.state, "missing", `${runner} nowhere on PATH is missing`);
    assert.equal(
      missing.state === "missing" && missing.code,
      RUNTIME_AVAILABILITY_ERROR_CODES.missing,
      "missing carries its distinct structured code",
    );
    assert.equal(
      missing.state === "missing" && missing.message,
      missingRunnerMessage(runner),
      "the gate and the post-spawn race handler share one remediation string",
    );
    assert.doesNotMatch(
      missing.state === "missing" ? missing.message : "",
      /authenticat/i,
      "installation remediation never suggests an authentication problem",
    );
  }

  // The chat client's "Open Setup" recovery matches this exact phrase
  // (src/components/chat-view.test.ts); the availability gate must keep it.
  assert.match(
    missingRunnerMessage("coven"),
    /Coven CLI not found on PATH/,
    "Coven missing copy stays pinned to the client recovery matcher",
  );

  const emptyPath = evaluateRuntimeAvailability({
    runner: "hermes",
    command: "hermes",
    env: {},
    platform: nativePlatform,
  });
  assert.equal(emptyPath.state, "missing", "an env without PATH resolves nothing");

  // Verification matrix: a found-but-unconvertible Windows shim → unlaunchable
  // (never "not installed").
  const shim = evaluateRuntimeAvailability({
    runner: "grok",
    command: "grok.cmd",
    env: { PATH: binDir },
    unresolvedWindowsShim: true,
    platform: "win32",
  });
  assert.equal(shim.state, "unlaunchable", "an unresolved Windows shim is unlaunchable");
  assert.equal(
    shim.state === "unlaunchable" && shim.code,
    RUNTIME_AVAILABILITY_ERROR_CODES.unlaunchable,
    "unlaunchable carries its distinct structured code",
  );
  assert.doesNotMatch(
    shim.state === "unlaunchable" ? shim.message : "",
    /not found/i,
    "an installed-but-unlaunchable runner is not described as missing",
  );

  // Verification matrix: the probe itself failing (EACCES statting a PATH
  // entry) → probe_failed, not a false "not installed".
  const probeFailed = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "copilot",
    env: { PATH: binDir },
    platform: "linux",
    statFile: () => {
      throw Object.assign(new Error(`EACCES: permission denied, stat '${binDir}/copilot'`), {
        code: "EACCES",
      });
    },
  });
  assert.equal(probeFailed.state, "probe_failed", "a failing probe is not reported as missing");
  assert.equal(
    probeFailed.state === "probe_failed" && probeFailed.code,
    RUNTIME_AVAILABILITY_ERROR_CODES.probe_failed,
    "probe_failed carries its distinct structured code",
  );
  assert.ok(
    probeFailed.state === "probe_failed" && !probeFailed.message.includes(binDir),
    "probe failures stay value-free (no local filesystem paths in user copy)",
  );

  // Windows direct spawns can only launch native executables. Simulated via
  // injected stats because POSIX filesystems cannot host C:\ paths.
  const winStats = (present: string[]) => {
    const set = new Set(present);
    return (candidate: string) => set.has(candidate);
  };
  const winEnv = { Path: "C:\\bin" };

  const winExe = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "copilot",
    env: winEnv,
    platform: "win32",
    statFile: winStats(["C:\\bin\\copilot.exe"]),
  });
  assert.equal(winExe.state, "ready", "win32 resolves bare names through Path with .exe");

  const winCmdOnly = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "copilot",
    env: winEnv,
    platform: "win32",
    statFile: winStats(["C:\\bin\\copilot.cmd"]),
  });
  assert.equal(
    winCmdOnly.state,
    "unlaunchable",
    "a .cmd-only npm install is truthfully unlaunchable for a direct spawn, not missing",
  );

  const winAbsent = evaluateRuntimeAvailability({
    runner: "copilot",
    command: "copilot",
    env: winEnv,
    platform: "win32",
    statFile: winStats([]),
  });
  assert.equal(winAbsent.state, "missing", "win32 with nothing on Path is missing");

  // An explicit native-executable command still diagnoses sibling shims of
  // its base name: hermes.exe missing while hermes.cmd exists is an
  // installed-but-unlaunchable state, not a missing install.
  const winExplicitExeShimOnly = evaluateRuntimeAvailability({
    runner: "hermes",
    command: "hermes.exe",
    env: winEnv,
    platform: "win32",
    statFile: winStats(["C:\\bin\\hermes.cmd"]),
  });
  assert.equal(
    winExplicitExeShimOnly.state,
    "unlaunchable",
    "a .cmd-only install behind an explicit .exe spawn is unlaunchable, not missing",
  );
  assert.match(
    winExplicitExeShimOnly.state === "unlaunchable" ? winExplicitExeShimOnly.message : "",
    /command shim/,
    "the explicit-.exe shim-only diagnosis reports the shim reinstall remediation",
  );
  const winExplicitExeAbsent = evaluateRuntimeAvailability({
    runner: "hermes",
    command: "hermes.exe",
    env: winEnv,
    platform: "win32",
    statFile: winStats([]),
  });
  assert.equal(
    winExplicitExeAbsent.state,
    "missing",
    "an explicit .exe with no install at all remains missing",
  );

  const hermesPlan = resolveHermesLaunch({
    env: { ...process.env, Path: "C:\\bin" },
    platform: "win32",
    statFile: winStats(["C:\\bin\\hermes.exe"]),
  });
  assert.equal(hermesPlan.state, "ready", "Hermes resolves a native Windows executable into one launch plan");
  if (hermesPlan.state === "ready") {
    assert.equal(hermesPlan.command, "C:\\bin\\hermes.exe");
    assert.equal(hermesPlan.env.Path, "C:\\bin");
  }
  const hermesCmdOnly = resolveHermesLaunch({
    env: { ...process.env, Path: "C:\\bin" },
    platform: "win32",
    statFile: winStats(["C:\\bin\\hermes.cmd"]),
  });
  assert.equal(hermesCmdOnly.state, "unlaunchable", "a Windows Hermes .cmd shim is not a direct launch target");
  const relativeHermes = resolveHermesLaunch({
    env: { ...process.env, PATH: "bin" },
    cwd: "/virtual/workspace",
    platform: "linux",
    statFile: (candidate) => candidate === "/virtual/workspace/bin/hermes",
  });
  assert.equal(relativeHermes.state, "ready", "relative PATH entries resolve from the direct spawn cwd");
  assert.equal(
    runtimeProcessFailure("hermes").code,
    RUNTIME_AVAILABILITY_ERROR_CODES.process_failed,
    "a started Hermes process has a structured error distinct from availability",
  );

  // OpenCode's Windows launch is PowerShell-hosted: the host must exist and
  // the inner `opencode` command must resolve with PATHEXT semantics.
  const psHost = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const openCodeWinReady = evaluateRuntimeAvailability({
    runner: "opencode",
    command: psHost,
    env: { Path: "C:\\bin", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    platform: "win32",
    powerShellHostedCommand: "opencode",
    statFile: winStats([psHost, "C:\\bin\\opencode.CMD"]),
  });
  assert.equal(
    openCodeWinReady.state,
    "ready",
    "PowerShell-hosted OpenCode is ready when the host and the PATHEXT shim exist",
  );

  const openCodeWinMissing = evaluateRuntimeAvailability({
    runner: "opencode",
    command: psHost,
    env: { Path: "C:\\bin" },
    platform: "win32",
    powerShellHostedCommand: "opencode",
    statFile: winStats([psHost]),
  });
  assert.equal(
    openCodeWinMissing.state,
    "missing",
    "a present PowerShell host with no opencode shim is missing, with install copy",
  );

  const openCodeHostGone = evaluateRuntimeAvailability({
    runner: "opencode",
    command: psHost,
    env: { Path: "C:\\bin" },
    platform: "win32",
    powerShellHostedCommand: "opencode",
    statFile: winStats(["C:\\bin\\opencode.cmd"]),
  });
  assert.equal(
    openCodeHostGone.state,
    "unlaunchable",
    "a missing PowerShell host breaks the launch vehicle, not the install",
  );
  assert.match(
    openCodeHostGone.state === "unlaunchable" ? openCodeHostGone.message : "",
    /PowerShell/,
    "the host failure names the actual remediation target",
  );

  // Availability never executes anything: the whole evaluation uses bounded
  // filesystem inspection, so evaluating before every chat turn stays cheap
  // and side-effect free.
  // (Enforced structurally — the module must not import child_process.)
  const moduleSource = readFileSync(
    new URL("./runtime-availability.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    !moduleSource.includes("child_process"),
    "the availability probe must stay passive: no process spawning, ever",
  );

  // Wire-safe summary: no local resolved path leaves the machine surface.
  assert.deepEqual(summarizeRuntimeAvailability(ready), { state: "ready" });
  assert.deepEqual(summarizeRuntimeAvailability(shim), {
    state: "unlaunchable",
    code: RUNTIME_AVAILABILITY_ERROR_CODES.unlaunchable,
    message: shim.state === "unlaunchable" ? shim.message : "",
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("runtime-availability.test.ts: ok");
