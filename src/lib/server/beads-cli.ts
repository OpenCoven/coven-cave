import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubSidecarInternalEnv } from "@/lib/coven-bin";

const execFileAsync = promisify(execFile);
const BD_TIMEOUT_MS = 30_000;
const MAX_BD_BUFFER = 16 * 1024 * 1024;

type ExecResult = { stdout: string; stderr: string };
type Exec = (
  file: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<ExecResult>;

export type BdResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; status: number; error: string; stdout: string; stderr: string };

function commandError(error: unknown) {
  return error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
}

class BdUnavailableError extends Error {}

async function wslPath(exec: Exec, value: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await exec("wsl.exe", ["-e", "wslpath", "-a", "-u", value], {
    env,
    timeout: BD_TIMEOUT_MS,
    maxBuffer: MAX_BD_BUFFER,
  });
  const translated = stdout.trim();
  if (!translated.startsWith("/")) throw new Error("WSL could not translate the project path");
  return translated;
}

async function runBdViaWsl(
  exec: Exec,
  repoRoot: string,
  beadsDir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  const [wslRepoRoot, wslBeadsDir, resolved] = await Promise.all([
    wslPath(exec, repoRoot, env),
    wslPath(exec, beadsDir, env),
    exec("wsl.exe", ["-e", "sh", "-lc", "command -v bd"], {
      env,
      timeout: BD_TIMEOUT_MS,
      maxBuffer: MAX_BD_BUFFER,
    }).catch((error) => {
      throw new BdUnavailableError(commandError(error).message || "bd unavailable in WSL");
    }),
  ]);
  const bd = resolved.stdout.trim();
  if (!bd.startsWith("/")) throw new BdUnavailableError("bd unavailable in WSL");

  // User-controlled Beads args remain individual argv entries. The only shell
  // invocation above is the fixed `command -v bd` discovery string.
  return exec(
    "wsl.exe",
    [
      "--cd",
      wslRepoRoot,
      "-e",
      "/usr/bin/env",
      `BEADS_DIR=${wslBeadsDir}`,
      "BD_NON_INTERACTIVE=1",
      bd,
      ...args,
    ],
    { env, timeout: BD_TIMEOUT_MS, maxBuffer: MAX_BD_BUFFER },
  );
}

export async function runBdCommand(
  repoRoot: string,
  beadsDir: string,
  args: string[],
  options?: { platform?: NodeJS.Platform; exec?: Exec },
): Promise<BdResult> {
  const platform = options?.platform ?? process.platform;
  const exec = options?.exec ?? (execFileAsync as unknown as Exec);
  const env = scrubSidecarInternalEnv({
    ...process.env,
    BEADS_DIR: beadsDir,
    BD_NON_INTERACTIVE: "1",
  });

  try {
    const { stdout, stderr } = await exec("bd", args, {
      cwd: repoRoot,
      env,
      timeout: BD_TIMEOUT_MS,
      maxBuffer: MAX_BD_BUFFER,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const direct = commandError(error);
    if (direct.code !== "ENOENT" || platform !== "win32") {
      return {
        ok: false,
        status: direct.code === "ENOENT" ? 503 : 502,
        error: direct.code === "ENOENT" ? "bd unavailable" : direct.message || "bd command failed",
        stdout: direct.stdout ?? "",
        stderr: direct.stderr ?? "",
      };
    }
  }

  try {
    const { stdout, stderr } = await runBdViaWsl(exec, repoRoot, beadsDir, args, env);
    return { ok: true, stdout, stderr };
  } catch (error) {
    const fallback = commandError(error);
    const unavailable = fallback.code === "ENOENT" || error instanceof BdUnavailableError;
    return {
      ok: false,
      status: unavailable ? 503 : 502,
      error: unavailable
        ? "bd unavailable on Windows and in WSL"
        : fallback.message || "bd command failed",
      stdout: fallback.stdout ?? "",
      stderr: fallback.stderr ?? fallback.message ?? "",
    };
  }
}
