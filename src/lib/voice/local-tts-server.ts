import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PIPER_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 8_000;
const FORBIDDEN_SPAWN_ENV_KEYS = new Set([
  "GITHUB_PAT",
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
]);

function piperSpawnEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("COVEN_CAVE_") &&
        !key.startsWith("__NEXT_PRIVATE_") &&
        !FORBIDDEN_SPAWN_ENV_KEYS.has(key),
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

/**
 * Run Piper as a local child of the Node sidecar. The executable resolves
 * through PATH, keeping the packaged route's file trace deterministic.
 */
export const runPiper: PiperRunner = async (modelPath, text, signal) => {
  const outputPath = path.join(
    /* turbopackIgnore: true */ os.tmpdir(),
    `coven-piper-${process.pid}-${randomUUID()}.wav`,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "piper",
        ["-m", modelPath, "-f", outputPath, "--", text],
        {
          env: piperSpawnEnv(),
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => {
        child.kill();
        finish(
          new LocalTtsSynthesisError(
            "local_tts_cancelled",
            "Local speech synthesis was cancelled.",
          ),
        );
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(
          new LocalTtsSynthesisError(
            "local_tts_failed",
            "Piper took too long to synthesize this utterance.",
          ),
        );
      }, PIPER_TIMEOUT_MS);

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_STDERR_CHARS) {
          stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
        }
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(
          error.code === "ENOENT"
            ? new LocalTtsSynthesisError(
                "local_tts_engine_unavailable",
                "Piper isn't installed. Install piper-tts and make piper available on PATH.",
              )
            : new LocalTtsSynthesisError(
                "local_tts_failed",
                `Piper couldn't start (${error.message}).`,
              ),
        );
      });
      child.on("close", (code) => {
        if (code === 0) {
          finish();
          return;
        }
        const detail = stderr.trim();
        finish(
          new LocalTtsSynthesisError(
            "local_tts_failed",
            detail
              ? `Piper failed: ${detail}`
              : `Piper exited with code ${code ?? "unknown"}.`,
          ),
        );
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });

    const info = await stat(/* turbopackIgnore: true */ outputPath);
    if (!info.isFile() || info.size === 0 || info.size > MAX_AUDIO_BYTES) {
      throw new LocalTtsSynthesisError(
        "local_tts_failed",
        "Piper returned invalid or oversized audio.",
      );
    }
    return new Uint8Array(await readFile(/* turbopackIgnore: true */ outputPath));
  } finally {
    await rm(/* turbopackIgnore: true */ outputPath, { force: true }).catch(() => undefined);
  }
};
