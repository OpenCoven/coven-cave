import { harnessSpawnEnv } from "./harness-spawn-env.ts";

/** OpenCode is installed as `opencode` on all supported desktop platforms. */
export function openCodeCommand(): string {
  return "opencode";
}

/**
 * Preserve the familiar's scoped vault environment while making WSL's CLI
 * runnable outside a login session. The snap/node launcher rejects the absent
 * `/run/user/<uid>` directory; `/tmp` is sufficient for OpenCode's ephemeral
 * local runtime files and is never sent to a remote host.
 */
export function openCodeSpawnEnv(familiarId?: string | null): NodeJS.ProcessEnv {
  const env = harnessSpawnEnv(familiarId);
  if (process.platform !== "win32" && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = "/tmp";
  return env;
}
