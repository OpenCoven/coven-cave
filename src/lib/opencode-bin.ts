import type { ChildProcess } from "node:child_process";
import { harnessSpawnEnv } from "./harness-spawn-env.ts";

/** OpenCode is installed as `opencode` on all supported desktop platforms. */
export function openCodeCommand(): string {
  return "opencode";
}

export type OpenCodeLaunch = { command: string; args: string[]; input?: string };

function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const systemRoot = (env.SystemRoot ?? env.WINDIR ?? "C:\\Windows").replace(/[\\/]+$/, "");
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/**
 * Npm installs OpenCode's executable as `opencode.cmd` on Windows. Node's
 * `spawn("opencode")` cannot launch a cmd shim, while `shell: true` would
 * concatenate an untrusted chat prompt into a shell command. PowerShell can
 * invoke the shim. Its complete argv arrives as JSON over stdin, so punctuation
 * remains data rather than command syntax and a large chat prompt does not
 * exceed Windows' command-line length limit.
 */
export function openCodeLaunch(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): OpenCodeLaunch {
  if (platform !== "win32") return { command: openCodeCommand(), args: [...args] };
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$utf8 = New-Object System.Text.UTF8Encoding $false",
    "[Console]::InputEncoding = $utf8",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "$openCodeArgs = [Console]::In.ReadToEnd() | ConvertFrom-Json",
    "& opencode @openCodeArgs",
    "exit $LASTEXITCODE",
  ].join("; ");
  return {
    command: windowsPowerShell(env),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    input: JSON.stringify(args),
  };
}

/** Feed a Windows launch's argv after its PowerShell host has started. */
export function writeOpenCodeLaunchInput(
  child: Pick<ChildProcess, "stdin">,
  launch: OpenCodeLaunch,
): void {
  if (launch.input === undefined || !child.stdin) return;
  // A missing executable can close stdin before this write; the child error
  // handler owns that user-facing failure, so do not turn EPIPE into a server
  // exception here.
  child.stdin.on("error", () => {});
  child.stdin.end(launch.input);
}

/**
 * OpenCode needs an XDG runtime directory on POSIX. WSL can inherit a stale
 * Windows-login path, while a native macOS/Linux login may already provide a
 * valid one. Windows does not use this convention.
 */
export function openCodeNeedsTmpRuntimeDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  const isWsl = platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  return isWsl || (platform !== "win32" && !env.XDG_RUNTIME_DIR);
}

/**
 * Preserve the familiar's scoped vault environment while making WSL's CLI
 * runnable outside a login session. The snap/node launcher rejects the absent
 * `/run/user/<uid>` directory; `/tmp` is sufficient for OpenCode's ephemeral
 * local runtime files and is never sent to a remote host.
 */
export function openCodeSpawnEnv(familiarId?: string | null): NodeJS.ProcessEnv {
  const env = harnessSpawnEnv(familiarId);
  if (openCodeNeedsTmpRuntimeDir(process.platform, env)) {
    env.XDG_RUNTIME_DIR = "/tmp";
  }
  return env;
}
