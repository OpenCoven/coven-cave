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
  evaluateRuntimeAvailability,
  missingRunnerMessage,
  summarizeRuntimeAvailability,
  RUNTIME_AVAILABILITY_ERROR_CODES,
} from "./runtime-availability.ts";
import { openCodeCommand, openCodeLaunch } from "./opencode-bin.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "runtime-availability-"));
try {
  const binDir = path.join(scratch, "bin");
  const emptyDir = path.join(scratch, "empty");
  mkdirSync(binDir);
  mkdirSync(emptyDir);
  const executable = path.join(binDir, "grok");
  writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
  chmodSync(executable, 0o755);

  // Verification matrix: binary resolves in the spawn env → ready.
  // Do not use this Windows host's temporary path while simulating Linux:
  // a drive letter contains `:`, which is a POSIX PATH delimiter.
  const posixBinDir = "/runtime-availability/bin";
  const ready = evaluateRuntimeAvailability({
    runner: "grok",
    command: "grok",
    env: { PATH: `/runtime-availability/empty:${posixBinDir}` },
    platform: "linux",
    statFile: (candidate) => candidate === `${posixBinDir}/grok`,
  });
  assert.equal(ready.state, "ready", "a bare command on the spawn PATH is ready");
  assert.equal(
    ready.state === "ready" && ready.resolvedPath,
    `${posixBinDir}/grok`,
    "ready reports where the exact spawn command resolved",
  );

  const absoluteReady = evaluateRuntimeAvailability({
    runner: "coven",
    command: `${posixBinDir}/grok`,
    env: { PATH: "" },
    platform: "linux",
    statFile: (candidate) => candidate === `${posixBinDir}/grok`,
  });
  assert.equal(absoluteReady.state, "ready", "an absolute launch command is stat'd directly");

  if (process.platform !== "win32") {
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
      executable,
      "PATH resolution reports the exact later executable that won",
    );
  }

  // Verification matrix: binary absent from every discovery location →
  // missing, with per-runner install/PATH remediation.
  for (const runner of ["coven", "copilot", "grok", "hermes", "opencode"] as const) {
    const missing = evaluateRuntimeAvailability({
      runner,
      command: runner === "coven" ? "coven" : runner,
      env: { PATH: emptyDir },
      platform: "linux",
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
    platform: "linux",
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

  // OpenCode's Windows launch is PowerShell-hosted: the host must exist and
  // the inner `opencode` command must resolve with PATHEXT semantics.
  const openCodeWindowsLaunch = openCodeLaunch(
    ["run", "safe & literal"],
    "win32",
    { SystemRoot: "C:\\Windows" },
  );
  const psHost = openCodeWindowsLaunch.command;
  assert.equal(
    openCodeWindowsLaunch.input,
    JSON.stringify(["run", "safe & literal"]),
    "the preflight receives the same JSON-stdin launch plan as chat",
  );
  const openCodeWinReady = evaluateRuntimeAvailability({
    runner: "opencode",
    command: psHost,
    env: { Path: "C:\\bin", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    platform: "win32",
    powerShellHostedCommand: openCodeWindowsLaunch.input === undefined ? undefined : openCodeCommand(),
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
  assert.doesNotMatch(
    openCodeHostGone.state === "unlaunchable" ? openCodeHostGone.message : "",
    /OpenCode CLI not found/i,
    "a missing host never blames the inner OpenCode command",
  );

  const openCodeInnerProbeFailed = evaluateRuntimeAvailability({
    runner: "opencode",
    command: psHost,
    env: { Path: "C:\\bin" },
    platform: "win32",
    powerShellHostedCommand: openCodeCommand(),
    statFile: (candidate) => {
      if (candidate === psHost) return true;
      throw Object.assign(new Error(`EACCES: permission denied, stat '${candidate}'`), {
        code: "EACCES",
      });
    },
  });
  assert.equal(
    openCodeInnerProbeFailed.state,
    "probe_failed",
    "an unreadable inner OpenCode command is not reported as missing",
  );
  assert.ok(
    openCodeInnerProbeFailed.state === "probe_failed" && !openCodeInnerProbeFailed.message.includes("C:\\bin"),
    "hosted-command probe errors do not leak the launch PATH",
  );

  // Availability never executes anything: the whole evaluation is stat-only,
  // so evaluating before every chat turn stays cheap and side-effect free.
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
