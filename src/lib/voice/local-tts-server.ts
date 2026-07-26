import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PIPER_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 8_000;
const PIPER_PROBE_TIMEOUT_MS = 3_000;
const PIPER_PROBE_TERMINATION_GRACE_MS = 1_000;
const PIPER_FILE_CHECK_INTERVAL_MS = 100;
const PIPER_TERMINATION_GRACE_MS = 1_000;
const PIPER_FORCE_KILL_SETTLE_MS = 1_000;

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

type PiperSpawn = typeof spawn;

type PiperTiming = {
  timeoutMs: number;
  fileCheckIntervalMs: number;
  terminationGraceMs: number;
  forceKillSettleMs: number;
};

const defaultPiperTiming: PiperTiming = {
  timeoutMs: PIPER_TIMEOUT_MS,
  fileCheckIntervalMs: PIPER_FILE_CHECK_INTERVAL_MS,
  terminationGraceMs: PIPER_TERMINATION_GRACE_MS,
  forceKillSettleMs: PIPER_FORCE_KILL_SETTLE_MS,
};

type LocalTtsProbeHints = {
  /** The runtime binary could not be spawned at all. */
  install: string;
  /** The runtime spawned but had to be terminated after the probe timeout. */
  unresponsive: string;
  /** The runtime exited with a non-zero status. */
  broken: string;
};

async function probeLocalTtsRuntime(
  executable: string,
  hints: LocalTtsProbeHints,
  dependencies: {
    spawnImpl?: PiperSpawn;
    timeoutMs?: number;
    terminationGraceMs?: number;
  } = {},
): Promise<PiperRuntimeAvailability> {
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? PIPER_PROBE_TIMEOUT_MS;
  const terminationGraceMs =
    dependencies.terminationGraceMs ?? PIPER_PROBE_TERMINATION_GRACE_MS;
  return new Promise<PiperRuntimeAvailability>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let terminating = false;
    const finish = (value: PiperRuntimeAvailability) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve(value);
    };
    let child: ChildProcess;
    try {
      child = spawnImpl(executable, ["--help"], {
        env: piperSpawnEnv(),
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      finish({ available: false, hint: hints.install });
      return;
    }
    timeout = setTimeout(() => {
      terminating = true;
      try {
        child.kill();
      } catch {
        // A concurrent close is handled by its event below.
      }
      // A corrupted runtime can ignore SIGTERM on POSIX. Escalate before
      // reporting it unavailable so repeated catalog refreshes cannot leak
      // background probe processes.
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may have exited while the timer was pending.
        }
        finish({ available: false, hint: hints.unresponsive });
      }, terminationGraceMs);
    }, timeoutMs);
    child.once("error", () => {
      finish({ available: false, hint: terminating ? hints.unresponsive : hints.install });
    });
    child.once("close", (code) => {
      finish(terminating
        ? { available: false, hint: hints.unresponsive }
        : code === 0
          ? { available: true }
          : { available: false, hint: hints.broken });
    });
  });
}

/** Probe Piper with the same bounded termination policy as synthesis. */
export async function probePiperRuntime(
  executable: string,
  dependencies: {
    spawnImpl?: PiperSpawn;
    timeoutMs?: number;
    terminationGraceMs?: number;
  } = {},
): Promise<PiperRuntimeAvailability> {
  return probeLocalTtsRuntime(executable, {
    install: "Install the local Piper runtime before selecting a Piper voice.",
    unresponsive: "Piper did not respond. Install the supported local Piper runtime.",
    broken: "The local Piper runtime is unavailable. Check its installation.",
  }, dependencies);
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
  const value = await probePiperRuntime(executable);
  piperAvailability = { checkedAt: Date.now(), value };
  return value;
}

let kokoroAvailability: { checkedAt: number; value: PiperRuntimeAvailability } | null = null;

/**
 * Kokoro synthesis runs through the sherpa-onnx offline TTS CLI. Packaged
 * builds will inject COVEN_KOKORO_BIN once the runtime ships as a signed app
 * resource (packaging follow-up to cave-tr09i); until then PATH resolution is
 * development-only so a packaged app never executes an arbitrary binary.
 */
export function kokoroExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.COVEN_KOKORO_BIN?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return env.COVEN_CAVE_BUNDLE === "1" ? null : "sherpa-onnx-offline-tts";
}

/** Probe the sherpa-onnx Kokoro runtime with the same termination policy. */
export async function probeKokoroRuntime(
  executable: string,
  dependencies: {
    spawnImpl?: PiperSpawn;
    timeoutMs?: number;
    terminationGraceMs?: number;
  } = {},
): Promise<PiperRuntimeAvailability> {
  return probeLocalTtsRuntime(executable, {
    install: "Install the sherpa-onnx-offline-tts runtime before selecting a Kokoro voice.",
    unresponsive: "The Kokoro runtime did not respond. Install the supported sherpa-onnx-offline-tts runtime.",
    broken: "The local Kokoro runtime is unavailable. Check its installation.",
  }, dependencies);
}

export async function kokoroRuntimeAvailability(): Promise<PiperRuntimeAvailability> {
  if (kokoroAvailability && Date.now() - kokoroAvailability.checkedAt < PIPER_PROBE_TIMEOUT_MS) {
    return kokoroAvailability.value;
  }
  const executable = kokoroExecutable();
  if (!executable) {
    return {
      available: false,
      hint: "This CovenCave build doesn't bundle the Kokoro runtime yet. Kokoro voices need the sherpa-onnx-offline-tts runtime.",
    };
  }
  const value = await probeKokoroRuntime(executable);
  kokoroAvailability = { checkedAt: Date.now(), value };
  return value;
}

// Both local runtimes consume exactly one utterance per request. Collapse all
// user whitespace up front so streamed text cannot become multiple synthesis
// requests (Piper treats each stdin line as a request) or mangled argv
// (Kokoro receives the utterance as a positional argument).
function normalizeLocalTtsUtterance(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

type LocalTtsChildRequest = {
  /** Prefix for user-facing failure messages, e.g. "Piper failed: …". */
  label: "Piper" | "Kokoro";
  /** mkdtemp prefix for the private WAV output directory. */
  tempPrefix: string;
  executable: string;
  /** argv given the private WAV output path chosen by the harness. */
  buildArgs: (outputPath: string) => string[];
  /** When set, written to the child's stdin with the protocol newline;
   *  otherwise stdin is not opened at all. */
  stdinUtterance?: string;
  /** ENOENT at spawn time, phrased per engine. */
  engineUnavailableMessage: string;
  signal?: AbortSignal;
  spawnImpl: PiperSpawn;
  timing: PiperTiming;
  removeImpl: typeof rm;
};

/**
 * Shared hardened child-to-WAV harness: private 0o700 temp directory,
 * scrubbed environment, bounded runtime with SIGTERM→SIGKILL escalation,
 * bounded output size, and guaranteed temp cleanup.
 */
async function synthesizeWithLocalTtsChild(request: LocalTtsChildRequest): Promise<Uint8Array> {
  const { label, signal, spawnImpl, timing, removeImpl } = request;
  const outputDirectory = await mkdtemp(
    path.join(/* turbopackIgnore: true */ os.tmpdir(), request.tempPrefix),
  );
  const outputPath = path.join(/* turbopackIgnore: true */ outputDirectory, "speech.wav");
  try {
    // mkdtemp creates a private directory on POSIX; chmod makes that privacy
    // boundary explicit before the runtime receives a path to write
    // conversational audio into. Windows ignores POSIX permission bits safely.
    await chmod(/* turbopackIgnore: true */ outputDirectory, 0o700);
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawnImpl(request.executable, request.buildArgs(outputPath), {
        env: piperSpawnEnv(),
        stdio: [request.stdinUtterance === undefined ? "ignore" : "pipe", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      let settled = false;
      let terminating: LocalTtsSynthesisError | null = null;
      let checkingFile = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      let forceSettleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(fileCheck);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (forceSettleTimer) clearTimeout(forceSettleTimer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const terminate = (error: LocalTtsSynthesisError) => {
        if (terminating) return;
        terminating = error;
        child.stdin?.destroy();
        try {
          child.kill();
        } catch {
          // The child may have exited between the timeout and termination.
        }
        // SIGTERM can be ignored. Escalate, then settle even if a broken
        // process never emits close so the request and temp-file cleanup do
        // not outlive the configured timeout indefinitely.
        forceKillTimer = setTimeout(() => {
          if (settled) return;
          try {
            child.kill("SIGKILL");
          } catch {
            // The close event or final settle timer handles an exited child.
          }
          forceSettleTimer = setTimeout(
            () => finish(error),
            timing.forceKillSettleMs,
          );
        }, timing.terminationGraceMs);
      };
      const abort = () => terminate(new LocalTtsSynthesisError(
        "local_tts_cancelled",
        "Local speech synthesis was cancelled.",
      ));
      const timeout = setTimeout(() => terminate(new LocalTtsSynthesisError(
        "local_tts_failed",
        `${label} took too long to synthesize this utterance.`,
      )), timing.timeoutMs);
      const fileCheck = setInterval(() => {
        if (checkingFile || terminating) return;
        checkingFile = true;
        void stat(/* turbopackIgnore: true */ outputPath)
          .then((info) => {
            if (info.size > MAX_AUDIO_BYTES) {
              terminate(new LocalTtsSynthesisError(
                "local_tts_failed",
                `${label} produced oversized audio.`,
              ));
            }
          })
          .catch(() => undefined)
          .finally(() => { checkingFile = false; });
      }, timing.fileCheckIntervalMs);

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
      });
      // A child that exits while its input is flushing can emit EPIPE on the
      // stdin stream without emitting a process-level error. Consume it here
      // so the sidecar fails this request instead of an unhandled stream error
      // taking down the Node process.
      child.stdin?.once("error", (error: Error) => {
        if (terminating) return;
        terminate(new LocalTtsSynthesisError(
          "local_tts_failed",
          `${label} input stream failed (${error.message}).`,
        ));
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (terminating) return finish(terminating);
        finish(error.code === "ENOENT"
          ? new LocalTtsSynthesisError("local_tts_engine_unavailable", request.engineUnavailableMessage)
          : new LocalTtsSynthesisError("local_tts_failed", `${label} couldn't start (${error.message}).`));
      });
      child.on("close", (code) => {
        if (terminating) return finish(terminating);
        if (code === 0) return finish();
        const detail = stderr.trim();
        finish(new LocalTtsSynthesisError(
          "local_tts_failed",
          detail ? `${label} failed: ${detail}` : `${label} exited with code ${code ?? "unknown"}.`,
        ));
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      if (request.stdinUtterance !== undefined) {
        child.stdin?.end(`${request.stdinUtterance}\n`);
      }
    });

    const info = await stat(/* turbopackIgnore: true */ outputPath);
    if (!info.isFile() || info.size === 0 || info.size > MAX_AUDIO_BYTES) {
      throw new LocalTtsSynthesisError("local_tts_failed", `${label} returned invalid or oversized audio.`);
    }
    return new Uint8Array(await readFile(/* turbopackIgnore: true */ outputPath));
  } finally {
    // Windows may retain a WAV handle briefly after a terminated child exits.
    // Retry transient locks so cancelled conversational audio is not left in
    // the shared temp directory.
    await removeImpl(/* turbopackIgnore: true */ outputDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch(() => undefined);
  }
}

export async function runPiperWithDependencies(
  modelPath: string,
  text: string,
  signal?: AbortSignal,
  dependencies: {
    spawnImpl?: PiperSpawn;
    executable?: string | null;
    timing?: Partial<PiperTiming>;
    removeImpl?: typeof rm;
  } = {},
): Promise<Uint8Array> {
  const executable = dependencies.executable ?? piperExecutable();
  if (!executable) {
    throw new LocalTtsSynthesisError(
      "local_tts_engine_unavailable",
      "The bundled Piper runtime is missing. Reinstall CovenCave before selecting a Piper voice.",
    );
  }
  const utterance = normalizeLocalTtsUtterance(text);
  if (!utterance) {
    throw new LocalTtsSynthesisError("local_tts_failed", "Piper received an empty utterance.");
  }
  return synthesizeWithLocalTtsChild({
    label: "Piper",
    tempPrefix: "coven-piper-",
    executable,
    buildArgs: (outputPath) => {
      // Piper's Windows/macOS/Linux archives keep espeak-ng-data beside the
      // executable. The sidecar runs from resources/server, so leaving this to
      // Piper's cwd-relative default makes every packaged voice fail to
      // phonemize despite the bundled runtime being present.
      const bundledEspeakData = path.join(
        /* turbopackIgnore: true */ path.dirname(executable),
        "espeak-ng-data",
      );
      const args = ["-m", modelPath, "-f", outputPath];
      if (existsSync(bundledEspeakData)) {
        args.push("--espeak_data", bundledEspeakData);
      }
      return args;
    },
    // Piper reads one utterance per stdin line. Do not pass text as argv:
    // that path is rejected by Piper's argument parser.
    stdinUtterance: utterance,
    engineUnavailableMessage:
      "The local Piper runtime isn't available. Install it before selecting a Piper voice.",
    signal,
    spawnImpl: dependencies.spawnImpl ?? spawn,
    timing: { ...defaultPiperTiming, ...dependencies.timing },
    removeImpl: dependencies.removeImpl ?? rm,
  });
}

/**
 * Run Piper as a local child of the Node sidecar. Packaged builds use the
 * signed resource path injected by the desktop launcher.
 */
export const runPiper: PiperRunner = async (modelPath, text, signal) => {
  return runPiperWithDependencies(modelPath, text, signal);
};

export type KokoroModelAssets = {
  modelPath: string;
  voicesPath: string;
  tokensPath: string;
  /** Registry-pinned row inside the voices file (sherpa-onnx --sid). */
  speakerId: number;
};

export type KokoroRunner = (
  assets: KokoroModelAssets,
  text: string,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export async function runKokoroWithDependencies(
  assets: KokoroModelAssets,
  text: string,
  signal?: AbortSignal,
  dependencies: {
    spawnImpl?: PiperSpawn;
    executable?: string | null;
    timing?: Partial<PiperTiming>;
    removeImpl?: typeof rm;
  } = {},
): Promise<Uint8Array> {
  const executable = dependencies.executable ?? kokoroExecutable();
  if (!executable) {
    throw new LocalTtsSynthesisError(
      "local_tts_engine_unavailable",
      "This CovenCave build doesn't bundle the Kokoro runtime yet. Kokoro voices need the sherpa-onnx-offline-tts runtime.",
    );
  }
  // The speaker id is registry data, but it still becomes argv for a child
  // process: reject anything that isn't a plain non-negative integer.
  if (!Number.isSafeInteger(assets.speakerId) || assets.speakerId < 0) {
    throw new LocalTtsSynthesisError("local_tts_failed", "Kokoro received an invalid speaker id.");
  }
  const utterance = normalizeLocalTtsUtterance(text);
  if (!utterance) {
    throw new LocalTtsSynthesisError("local_tts_failed", "Kokoro received an empty utterance.");
  }
  return synthesizeWithLocalTtsChild({
    label: "Kokoro",
    tempPrefix: "coven-kokoro-",
    executable,
    buildArgs: (outputPath) => {
      // sherpa-onnx archives keep espeak-ng-data beside the executable,
      // mirroring Piper's layout. Kokoro phonemization needs the explicit
      // path for the same reason Piper does: the sidecar's cwd is not the
      // runtime directory.
      const bundledEspeakData = path.join(
        /* turbopackIgnore: true */ path.dirname(executable),
        "espeak-ng-data",
      );
      return [
        `--kokoro-model=${assets.modelPath}`,
        `--kokoro-voices=${assets.voicesPath}`,
        `--kokoro-tokens=${assets.tokensPath}`,
        ...(existsSync(bundledEspeakData)
          ? [`--kokoro-data-dir=${bundledEspeakData}`]
          : []),
        `--sid=${assets.speakerId}`,
        `--output-filename=${outputPath}`,
        // sherpa-onnx-offline-tts takes the utterance as its positional
        // argument and ignores stdin entirely (the opposite of Piper).
        utterance,
      ];
    },
    engineUnavailableMessage:
      "The local Kokoro runtime isn't available. Install sherpa-onnx-offline-tts before selecting a Kokoro voice.",
    signal,
    spawnImpl: dependencies.spawnImpl ?? spawn,
    timing: { ...defaultPiperTiming, ...dependencies.timing },
    removeImpl: dependencies.removeImpl ?? rm,
  });
}

/**
 * Run Kokoro (via sherpa-onnx) as a local child of the Node sidecar, under
 * the same isolation contract as Piper.
 */
export const runKokoro: KokoroRunner = async (assets, text, signal) => {
  return runKokoroWithDependencies(assets, text, signal);
};
