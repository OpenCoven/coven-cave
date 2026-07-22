import { harnessSpawnEnv } from "./harness-spawn-env.ts";

/** OpenCode is installed as `opencode` on all supported desktop platforms. */
export function openCodeCommand(): string {
  return "opencode";
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
