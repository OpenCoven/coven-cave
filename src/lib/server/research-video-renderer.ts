import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type {
  ResearchGenerationStoryboardScene,
  ResearchMediaProvider,
} from "../research-generations.ts";
import { LOCAL_TTS_MAX_CHARS } from "../voice/local-tts.ts";
import type { ResearchMediaJobContext } from "./research-media-job-contract.ts";
import { RESEARCH_AUDIO_MAX_BYTES } from "./research-media-store.ts";
import {
  concatPcmWav,
  pcmWavDurationMs,
  synthesizeResearchPodcastSegment,
} from "./research-podcast-pipeline.ts";

const VIDEO_WIDTH = 1_280;
const VIDEO_HEIGHT = 720;
const COMMAND_OUTPUT_MAX_BYTES = 256 * 1024;

/**
 * Concrete server-artifact palette. These hex values are the sRGB equivalents
 * of the default Coven oklch declarations in
 * src/styles/globals/foundations.css. SVGs rendered by Sharp cannot inherit
 * browser CSS variables, and Sharp's librsvg does not parse oklch() at all —
 * oklch fills silently render as black (cave-6f88w; same defect fixed for the
 * infographic renderer in cave-ga0t5) — so the palette must stay in hex here.
 */
export const COVEN_VIDEO_RENDER_PALETTE = {
  background: "#1c1b1d",
  accent: "#9386d0",
  primaryText: "#fafafa",
  secondaryText: "#929198",
} as const;

export type ResearchVideoRenderPalette = {
  background: string;
  accent: string;
  primaryText: string;
  secondaryText: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrap(value: string, maxChars: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export function storyboardSceneToSvg(
  scene: ResearchGenerationStoryboardScene,
  palette: ResearchVideoRenderPalette = COVEN_VIDEO_RENDER_PALETTE,
): string {
  const titleLines = wrap(scene.title, 34).slice(0, 3);
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<text x="104" y="${142 + index * 58}" class="title">${escapeXml(line)}</text>`,
    )
    .join("");
  const bulletMarkup = scene.bullets
    .slice(0, 5)
    .flatMap((bullet, index) => {
      const lines = wrap(bullet, 64).slice(0, 2);
      return lines.map(
        (line, lineIndex) =>
          `<text x="${144 + (lineIndex === 0 ? 0 : 30)}" y="${
            350 + index * 68 + lineIndex * 28
          }" class="bullet">${
            lineIndex === 0 ? "• " : ""
          }${escapeXml(line)}</text>`,
      );
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}">
  <style>
    .base { fill: ${palette.background}; }
    .accent { fill: ${palette.accent}; }
    .title { fill: ${palette.primaryText}; font-family: system-ui, sans-serif; font-size: 48px; font-weight: 700; }
    .bullet { fill: ${palette.secondaryText}; font-family: system-ui, sans-serif; font-size: 28px; }
  </style>
  <rect width="100%" height="100%" class="base"/>
  <rect x="72" y="76" width="12" height="568" rx="6" class="accent"/>
  ${titleMarkup}
  ${bulletMarkup}
</svg>`;
}

export async function renderStoryboardStill(svg: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(Buffer.from(svg))
      .png()
      .toBuffer(),
  );
}

type ProcessStream = {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
  removeListener(event: "data", listener: (chunk: unknown) => void): unknown;
};

type SpawnedProcess = {
  stdout: ProcessStream | null;
  stderr: ProcessStream | null;
  exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(
    event: "error" | "close",
    listener: (...args: unknown[]) => void,
  ): unknown;
  removeListener(
    event: "error" | "close",
    listener: (...args: unknown[]) => void,
  ): unknown;
};

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => SpawnedProcess;

export type ResearchVideoCommandOptions = {
  cwd: string;
  signal: AbortSignal;
  killGraceMs?: number;
  escalateKill?: boolean;
  timeoutMs?: number;
  forceSettleMs?: number;
  spawnProcess?: SpawnProcess;
};

export type ResearchVideoCommandResult = {
  stdout: string;
  stderr: string;
};

function abortError(command: string): Error {
  const error = new Error(`${command} aborted`);
  error.name = "AbortError";
  return error;
}

function boundedAppend(current: string, chunk: unknown): string {
  if (Buffer.byteLength(current) >= COMMAND_OUTPUT_MAX_BYTES) return current;
  const appended = `${current}${Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)}`;
  return Buffer.byteLength(appended) <= COMMAND_OUTPUT_MAX_BYTES
    ? appended
    : Buffer.from(appended).subarray(0, COMMAND_OUTPUT_MAX_BYTES).toString("utf8");
}

export function runResearchVideoCommand(
  command: "ffmpeg" | "ffprobe",
  args: readonly string[],
  options: ResearchVideoCommandOptions,
): Promise<ResearchVideoCommandResult> {
  if (options.signal.aborted) return Promise.reject(abortError(command));
  const spawnProcess: SpawnProcess =
    options.spawnProcess ??
    ((spawnCommand, spawnArgs, spawnOptions) =>
      spawn(spawnCommand, spawnArgs, spawnOptions) as unknown as SpawnedProcess);
  const child = spawnProcess(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const killGraceMs = options.killGraceMs ?? 2_000;
  const escalateKill = options.escalateKill ?? true;
  const timeoutMs = options.timeoutMs ?? (command === "ffprobe" ? 15_000 : undefined);
  const forceSettleMs = options.forceSettleMs ?? 1_000;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let forceSettleTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationError: Error | undefined;

    const onStdout = (chunk: unknown) => {
      stdout = boundedAppend(stdout, chunk);
    };
    const onStderr = (chunk: unknown) => {
      stderr = boundedAppend(stderr, chunk);
    };
    const cleanup = () => {
      options.signal.removeEventListener("abort", onAbort);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      if (killTimer) clearTimeout(killTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
    const finish = (
      outcome:
        | { ok: true; value: ResearchVideoCommandResult }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };
    const onError = (error: unknown) => {
      finish({
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    };
    const onClose = (...args: unknown[]) => {
      const code = typeof args[0] === "number" ? args[0] : null;
      if (terminationError) {
        finish({ ok: false, error: terminationError });
      } else if (code === 0) {
        finish({ ok: true, value: { stdout, stderr } });
      } else {
        finish({
          ok: false,
          error: new Error(
            `${command} exited with code ${code ?? "unknown"}${
              stderr ? `: ${stderr.trim()}` : ""
            }`,
          ),
        });
      }
    };
    const terminate = (error: Error) => {
      if (settled || terminationError) return;
      terminationError = error;
      child.kill("SIGTERM");
      if (escalateKill) {
        killTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, killGraceMs);
      }
      forceSettleTimer = setTimeout(() => {
        finish({ ok: false, error: terminationError ?? error });
      }, killGraceMs + forceSettleMs);
    };
    const onAbort = () => terminate(abortError(command));

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        terminate(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    if (options.signal.aborted) onAbort();
  });
}

export type ResearchVideoProbe = {
  streams?: Array<{
    codec_type?: unknown;
    codec_name?: unknown;
    width?: unknown;
    height?: unknown;
    pix_fmt?: unknown;
  }>;
  format?: {
    duration?: unknown;
  };
};

export function validateResearchVideoProbe(
  value: unknown,
  maxDurationMs: number,
): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ffprobe returned invalid JSON");
  }
  const probe = value as ResearchVideoProbe;
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (video?.codec_name !== "h264") {
    throw new Error("rendered video must use H.264");
  }
  if (video.width !== VIDEO_WIDTH || video.height !== VIDEO_HEIGHT) {
    throw new Error("rendered video must be 1280×720");
  }
  if (video.pix_fmt !== "yuv420p") {
    throw new Error("rendered video must use yuv420p pixel format");
  }
  if (audio?.codec_name !== "aac") {
    throw new Error("rendered video must use AAC audio");
  }
  const seconds =
    typeof probe.format?.duration === "string" ||
    typeof probe.format?.duration === "number"
      ? Number(probe.format.duration)
      : Number.NaN;
  const durationMs = Math.round(seconds * 1_000);
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > maxDurationMs
  ) {
    throw new Error("rendered video exceeds its duration cap");
  }
  return durationMs;
}

export type ResearchVideoSequenceInput = {
  scenes: ResearchGenerationStoryboardScene[];
  provider: ResearchMediaProvider;
  voice: string;
  maxDurationMs: number;
  outputPath: string;
  workDir: string;
  signal: AbortSignal;
  reportStage: ResearchMediaJobContext["reportStage"];
};

export type ResearchVideoRendererDependencies = {
  synthesize?: typeof synthesizeResearchPodcastSegment;
  renderStill?: typeof renderStoryboardStill;
  runFfmpeg?: (
    args: string[],
    cwd: string,
    signal: AbortSignal,
  ) => Promise<void>;
  probeVideo?: (
    outputPath: string,
    cwd: string,
    signal: AbortSignal,
  ) => Promise<ResearchVideoProbe>;
};

async function defaultRunFfmpeg(
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  await runResearchVideoCommand("ffmpeg", args, { cwd, signal });
}

async function defaultProbeVideo(
  outputPath: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ResearchVideoProbe> {
  const result = await runResearchVideoCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      outputPath,
    ],
    { cwd, signal },
  );
  return JSON.parse(result.stdout) as ResearchVideoProbe;
}

export async function renderResearchVideoSequence(
  input: ResearchVideoSequenceInput,
  dependencies: ResearchVideoRendererDependencies = {},
): Promise<{
  durationMs: number;
  provider: ResearchMediaProvider;
  voice: string;
}> {
  if (input.scenes.length === 0) {
    throw new Error("video storyboard has no scenes");
  }
  if (
    !Number.isSafeInteger(input.maxDurationMs) ||
    input.maxDurationMs <= 0
  ) {
    throw new Error("invalid video duration cap");
  }
  await mkdir(input.workDir, { recursive: true });
  const synthesize =
    dependencies.synthesize ?? synthesizeResearchPodcastSegment;
  const renderStill = dependencies.renderStill ?? renderStoryboardStill;
  const runFfmpeg = dependencies.runFfmpeg ?? defaultRunFfmpeg;
  const probeVideo = dependencies.probeVideo ?? defaultProbeVideo;
  const audioChunks: Uint8Array[] = [];
  const durations: number[] = [];
  let cumulativeAudioBytes = 0;
  let cumulativeDurationMs = 0;

  await input.reportStage("scripting");
  for (const [index, scene] of input.scenes.entries()) {
    if (input.signal.aborted) throw abortError("video render");
    if (
      !scene.narration.trim() ||
      scene.narration.length > LOCAL_TTS_MAX_CHARS
    ) {
      throw new Error(
        `video scene ${index + 1} narration must be between 1 and ${LOCAL_TTS_MAX_CHARS} characters`,
      );
    }
    await input.reportStage("synthesizing");
    const synthesized = await synthesize(
      scene.narration,
      input.provider,
      input.voice,
      input.signal,
    );
    if (synthesized.voice !== input.voice) {
      throw new Error("selected video voice changed during synthesis");
    }
    cumulativeAudioBytes += synthesized.bytes.byteLength;
    if (cumulativeAudioBytes > RESEARCH_AUDIO_MAX_BYTES) {
      throw new Error("video narration exceeds the audio size limit");
    }
    const durationMs = pcmWavDurationMs(synthesized.bytes);
    cumulativeDurationMs += durationMs;
    if (cumulativeDurationMs > input.maxDurationMs) {
      throw new Error("video narration exceeds its duration cap");
    }
    audioChunks.push(synthesized.bytes);
    durations.push(durationMs);
    const still = await renderStill(storyboardSceneToSvg(scene));
    await writeFile(
      path.join(
        input.workDir,
        `scene-${String(index + 1).padStart(3, "0")}.png`,
      ),
      still,
    );
  }

  const audioBytes = concatPcmWav(audioChunks);
  const audioPath = path.join(input.workDir, "voiceover.wav");
  const manifestPath = path.join(input.workDir, "slides.txt");
  await writeFile(audioPath, audioBytes);
  const manifest = input.scenes.flatMap((_, index) => [
    `file 'scene-${String(index + 1).padStart(3, "0")}.png'`,
    `duration ${(durations[index] / 1_000).toFixed(3)}`,
  ]);
  manifest.push(
    `file 'scene-${String(input.scenes.length).padStart(3, "0")}.png'`,
  );
  await writeFile(manifestPath, `${manifest.join("\n")}\n`);

  if (input.signal.aborted) throw abortError("video render");
  await input.reportStage("encoding");
  const ffmpegArgs = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.basename(manifestPath),
    "-i",
    path.basename(audioPath),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-shortest",
    input.outputPath,
  ];
  await runFfmpeg(ffmpegArgs, input.workDir, input.signal);
  const probe = await probeVideo(
    input.outputPath,
    input.workDir,
    input.signal,
  );
  const durationMs = validateResearchVideoProbe(probe, input.maxDurationMs);
  return {
    durationMs,
    provider: input.provider,
    voice: input.voice,
  };
}
