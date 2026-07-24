import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PIPER_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 8_000;
const PIPER_PROBE_TIMEOUT_MS = 3_000;
const PIPER_FILE_CHECK_INTERVAL_MS = 100;

/**
 * Piper has no reason to receive the sidecar's provider credentials. Start
 * from an empty environment and retain only the OS variables required to find
 * and execute a local binary. In particular, never pass a user's Vault/API
 * keys to a PATH-resolved executable.
 */
export function piperSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const keys = platform === "win32"
    ? ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LANG", "LC_ALL", "LC_CTYPE"]
    : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"];
  return Object.fromEntries(
    keys.flatMap((key) =>
      env[key] === undefined ? [] : [[key, env[key]]],
    ),
  ) as NodeJS.ProcessEnv;
}

export class LocalTtsSynthesisError extends Error {
  readonly code:
    | "local_tts_engine_unavailable"
    | "local_tts_failed"
    | "local_tts_cancelled";

  constructor(
    code:
      | "local_tts_engine_unavailable"
      | "local_tts_failed"
      | "local_tts_cancelled",
    message: string,
  ) {
    super(message);
    this.name = "LocalTtsSynthesisError";
    this.code = code;
  }
}

export type PiperRunner = (
  modelPath: string,
  text: string,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export type PiperRuntimeAvailability = {
  available: boolean;
  hint?: string;
};

let piperAvailability: { checkedAt: number; value: PiperRuntimeAvailability } | null = null;

/**
 * Desktop releases set COVEN_PIPER_BIN to the signed app resource before the
 * Node sidecar starts. Development may explicitly set it too; PATH is only a
 * development fallback so a packaged app never executes an arbitrary binary.
 */
export function piperExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.COVEN_PIPER_BIN?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return env.COVEN_CAVE_BUNDLE === "1" ? null : "piper";
}

/** Probe the controlled, minimal environment used for synthesis. */
export async function piperRuntimeAvailability(): Promise<PiperRuntimeAvailability> {
  if (piperAvailability && Date.now() - piperAvailability.checkedAt < PIPER_PROBE_TIMEOUT_MS) {
    return piperAvailability.value;
  }
  const executable = piperExecutable();
  if (!executable) {
    return {
      available: false,
      hint: "The bundled Piper runtime is missing. Reinstall CovenCave before selecting a Piper voice.",
    };
  }
  const value = await new Promise<PiperRuntimeAvailability>((resolve) => {
    const child = spawn(executable, ["--help"], {
      env: piperSpawnEnv(),
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ available: false, hint: "Piper did not respond. Install the supported local Piper runtime." });
    }, PIPER_PROBE_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timeout);
      resolve({ available: false, hint: "Install the local Piper runtime before selecting a Piper voice." });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0
        ? { available: true }
        : { available: false, hint: "The local Piper runtime is unavailable. Check its installation." });
    });
  });
  piperAvailability = { checkedAt: Date.now(), value };
  return value;
}

type PiperSpawn = typeof spawn;

export async function runPiperWithDependencies(
  modelPath: string,
  text: string,
  signal?: AbortSignal,
  dependencies: { spawnImpl?: PiperSpawn; executable?: string | null } = {},
): Promise<Uint8Array> {
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const executable = dependencies.executable ?? piperExecutable();
  if (!executable) {
    throw new LocalTtsSynthesisError(
      "local_tts_engine_unavailable",
      "The bundled Piper runtime is missing. Reinstall CovenCave before selecting a Piper voice.",
    );
  }
  const outputPath = path.join(
    /* turbopackIgnore: true */ os.tmpdir(),
    `coven-piper-${process.pid}-${randomUUID()}.wav`,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawnImpl(executable, ["-m", modelPath, "-f", outputPath], {
        env: piperSpawnEnv(),
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      let settled = false;
      let terminating: LocalTtsSynthesisError | null = null;
      let checkingFile = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(fileCheck);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const terminate = (error: LocalTtsSynthesisError) => {
        if (terminating) return;
        terminating = error;
        child.kill();
      };
      const abort = () => terminate(new LocalTtsSynthesisError(
        "local_tts_cancelled",
        "Local speech synthesis was cancelled.",
      ));
      const timeout = setTimeout(() => terminate(new LocalTtsSynthesisError(
        "local_tts_failed",
        "Piper took too long to synthesize this utterance.",
      )), PIPER_TIMEOUT_MS);
      const fileCheck = setInterval(() => {
        if (checkingFile || terminating) return;
        checkingFile = true;
        void stat(/* turbopackIgnore: true */ outputPath)
          .then((info) => {
            if (info.size > MAX_AUDIO_BYTES) {
              terminate(new LocalTtsSynthesisError(
                "local_tts_failed",
                "Piper produced oversized audio.",
              ));
            }
          })
          .catch(() => undefined)
          .finally(() => { checkingFile = false; });
      }, PIPER_FILE_CHECK_INTERVAL_MS);

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(error.code === "ENOENT"
          ? new LocalTtsSynthesisError("local_tts_engine_unavailable", "The local Piper runtime isn't available. Install it before selecting a Piper voice.")
          : new LocalTtsSynthesisError("local_tts_failed", `Piper couldn't start (${error.message}).`));
      });
      child.on("close", (code) => {
        if (terminating) return finish(terminating);
        if (code === 0) return finish();
        const detail = stderr.trim();
        finish(new LocalTtsSynthesisError(
          "local_tts_failed",
          detail ? `Piper failed: ${detail}` : `Piper exited with code ${code ?? "unknown"}.`,
        ));
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      // Piper reads one utterance per stdin line. Do not pass text as argv:
      // that path is rejected by Piper's argument parser.
      child.stdin?.end(`${text}\n`);
    });

    const info = await stat(/* turbopackIgnore: true */ outputPath);
    if (!info.isFile() || info.size === 0 || info.size > MAX_AUDIO_BYTES) {
      throw new LocalTtsSynthesisError("local_tts_failed", "Piper returned invalid or oversized audio.");
    }
    return new Uint8Array(await readFile(/* turbopackIgnore: true */ outputPath));
  } finally {
    await rm(/* turbopackIgnore: true */ outputPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Run Piper as a local child of the Node sidecar. Packaged builds use the
 * signed resource path injected by the desktop launcher.
 */
export const runPiper: PiperRunner = async (modelPath, text, signal) => {
  return runPiperWithDependencies(modelPath, text, signal);
};
