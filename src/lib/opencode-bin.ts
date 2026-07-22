import { harnessSpawnEnv } from "./harness-spawn-env.ts";

/** OpenCode is installed as `opencode` on all supported desktop platforms. */
export function openCodeCommand(): string {
  return "opencode";
}

export type OpenCodeLaunch = { command: string; args: string[] };

function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const systemRoot = (env.SystemRoot ?? env.WINDIR ?? "C:\\Windows").replace(/[\\/]+$/, "");
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/**
 * Npm installs OpenCode's executable as `opencode.cmd` on Windows. Node's
 * `spawn("opencode")` cannot launch a cmd shim, while `shell: true` would
 * concatenate an untrusted chat prompt into a shell command. PowerShell can
 * invoke the shim and receives the complete argv as a base64 JSON payload, so
 * punctuation in a prompt remains data rather than command syntax.
 */
export function openCodeLaunch(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): OpenCodeLaunch {
  if (platform !== "win32") return { command: openCodeCommand(), args: [...args] };
  const encodedArgs = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$utf8 = New-Object System.Text.UTF8Encoding $false",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    `$openCodeArgs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedArgs}')) | ConvertFrom-Json`,
    "& opencode @openCodeArgs",
    "exit $LASTEXITCODE",
  ].join("; ");
  return {
    command: windowsPowerShell(env),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
  };
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
