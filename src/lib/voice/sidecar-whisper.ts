// Server-side whisper.cpp runner for Cave's local sidecar.
//
// The browser only sends a bounded WAV utterance to this loopback route. The
// selected GGML model and whisper-cli process remain sidecar-owned, so neither
// model paths nor command arguments are client-controlled.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { speechEnginesReadiness, type SpeechModelReadiness } from "./speech-models.ts";

const execFileAsync = promisify(execFile);

export const MAX_WHISPER_WAV_BYTES = 10 * 1024 * 1024;
export const WHISPER_TIMEOUT_MS = 120_000;

export class SidecarWhisperError extends Error {
  readonly code: "whisper_model_not_ready" | "whisper_unavailable" | "whisper_failed" | "whisper_empty";
  readonly hint: string;

  constructor(
    code: "whisper_model_not_ready" | "whisper_unavailable" | "whisper_failed" | "whisper_empty",
    hint: string,
  ) {
    super(code);
    this.name = "SidecarWhisperError";
    this.code = code;
    this.hint = hint;
  }
}

export type ReadyWhisperModel = Pick<SpeechModelReadiness, "id" | "name" | "path">;

export async function readyWhisperModel(): Promise<ReadyWhisperModel | null> {
  const engines = await speechEnginesReadiness();
  const model = engines.stt.find((candidate) => candidate.engine === "whisper" && candidate.ready);
  return model ? { id: model.id, name: model.name, path: model.path } : null;
}

export function whisperCliCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.COVEN_WHISPER_CPP_BIN?.trim() || "whisper-cli";
}

/** Probe the executable separately from the downloaded GGML model. A model
 * alone must never make the client advertise an engine that cannot start. */
export async function whisperRuntimeAvailable(command = whisperCliCommand()): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], {
      timeout: 1_500,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function whisperCliArgs(modelPath: string, wavPath: string, outputStem: string, lang?: string): string[] {
  return ["-m", modelPath, "-f", wavPath, "-otxt", "-of", outputStem, ...(lang ? ["-l", lang] : [])];
}

type RunWhisper = (command: string, args: string[], signal?: AbortSignal) => Promise<void>;

async function defaultRunWhisper(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  try {
    await execFileAsync(command, args, {
      timeout: WHISPER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      signal,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).name === "AbortError" || signal?.aborted) {
      throw new SidecarWhisperError("whisper_failed", "Local Whisper transcription was cancelled.");
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new SidecarWhisperError(
        "whisper_unavailable",
        "The local Whisper runtime is unavailable. Install whisper.cpp or set COVEN_WHISPER_CPP_BIN to its whisper-cli executable.",
      );
    }
    throw new SidecarWhisperError(
      "whisper_failed",
      "Local Whisper could not transcribe that utterance. Check the downloaded model and try again.",
    );
  }
}

export async function transcribeSidecarWav(
  wav: Uint8Array,
  model: ReadyWhisperModel,
  options: { lang?: string; run?: RunWhisper; tempRoot?: string; signal?: AbortSignal } = {},
): Promise<string> {
  if (wav.byteLength === 0 || wav.byteLength > MAX_WHISPER_WAV_BYTES) {
    throw new SidecarWhisperError("whisper_failed", "The recorded utterance is too large for local Whisper.");
  }
  const tempDir = await mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), "coven-whisper-"));
  const wavPath = path.join(tempDir, "utterance.wav");
  const outputStem = path.join(tempDir, "transcript");
  try {
    await writeFile(wavPath, wav, { mode: 0o600 });
    if (options.signal?.aborted) {
      throw new SidecarWhisperError("whisper_failed", "Local Whisper transcription was cancelled.");
    }
    await (options.run ?? defaultRunWhisper)(
      whisperCliCommand(),
      whisperCliArgs(model.path, wavPath, outputStem, options.lang),
      options.signal,
    );
    const text = (await readFile(`${outputStem}.txt`, "utf8")).trim();
    if (!text) {
      throw new SidecarWhisperError("whisper_empty", "Local Whisper did not hear any words. Try speaking a little closer to the microphone.");
    }
    return text;
  } catch (error) {
    if (error instanceof SidecarWhisperError) throw error;
    throw new SidecarWhisperError(
      "whisper_failed",
      "Local Whisper could not read its transcription result. Try again.",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
