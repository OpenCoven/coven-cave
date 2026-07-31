import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  ResearchGenerationMediaKind,
  ResearchMediaReadiness,
  ResearchMediaReadyVoice,
  ResearchMediaRenderConfig,
} from "../research-generations.ts";
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  isValidElevenLabsVoiceId,
} from "../voice/elevenlabs-shared.ts";
import { resolveSecret } from "../vault.ts";
import { speechEnginesReadiness } from "../voice/speech-models.ts";

const execFileAsync = promisify(execFile);
const probeOptions = { timeout: 3_000, maxBuffer: 32 * 1024 };

type ReadinessVoice = {
  id: string;
  name: string;
  engine: "whisper" | "piper" | "kokoro";
  ready: boolean;
};

type ReadinessDependencies = {
  speechReadiness?: () => Promise<{ tts: ReadinessVoice[] }>;
  elevenLabsKey?: () => string | undefined;
  probeCommand?: (
    command: "ffmpeg" | "ffprobe",
  ) => Promise<{ ready: boolean }>;
};

async function probeCommand(
  command: "ffmpeg" | "ffprobe",
): Promise<{ ready: boolean }> {
  try {
    await execFileAsync(command, ["-version"], probeOptions);
    return { ready: true };
  } catch {
    return { ready: false };
  }
}

function availability(
  ready: boolean,
  hint: string,
): { ready: boolean; hint?: string } {
  return ready ? { ready: true } : { ready: false, hint };
}

export async function getResearchMediaReadiness(
  dependencies: ReadinessDependencies = {},
): Promise<ResearchMediaReadiness> {
  const inspectCommand = dependencies.probeCommand ?? probeCommand;
  const [speech, ffmpegProbe, ffprobeProbe] = await Promise.all([
    (dependencies.speechReadiness ?? speechEnginesReadiness)(),
    inspectCommand("ffmpeg"),
    inspectCommand("ffprobe"),
  ]);
  const voices = speech.tts
    .filter(
      (
        voice,
      ): voice is ReadinessVoice & {
        engine: ResearchMediaReadyVoice["engine"];
      } =>
        voice.ready &&
        (voice.engine === "piper" || voice.engine === "kokoro"),
    )
    .map(({ id, name, engine }) => ({ id, name, engine }));
  const localReady = voices.length > 0;
  const elevenLabsReady = Boolean(
    (dependencies.elevenLabsKey ??
      (() => resolveSecret("ELEVENLABS_API_KEY")))(),
  );
  const providerReady = localReady || elevenLabsReady;
  const providerHint =
    "Download a local voice in Settings → Voice, or set ELEVENLABS_API_KEY in Vault settings.";
  const toolchainReady = ffmpegProbe.ready && ffprobeProbe.ready;
  const toolchainHint = !ffmpegProbe.ready
    ? "Install ffmpeg to enable video rendering."
    : "Install ffprobe to verify rendered video output.";
  const videoReady = providerReady && toolchainReady;
  const videoHint = providerReady ? toolchainHint : providerHint;

  return {
    providers: {
      local: {
        ready: localReady,
        voices,
        ...(localReady
          ? {}
          : { hint: "Download a local voice in Settings → Voice." }),
      },
      elevenlabs: {
        ready: elevenLabsReady,
        defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
        ...(elevenLabsReady
          ? {}
          : { hint: "Set ELEVENLABS_API_KEY in Vault settings." }),
      },
    },
    ffmpeg: availability(toolchainReady, toolchainHint),
    podcast: availability(providerReady, providerHint),
    shortVideo: availability(videoReady, videoHint),
    longVideo: availability(videoReady, videoHint),
  };
}

export type ResearchMediaSelectionValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateResearchMediaSelection(
  kind: ResearchGenerationMediaKind,
  config: ResearchMediaRenderConfig,
  readiness: ResearchMediaReadiness,
): ResearchMediaSelectionValidation {
  const configuredVoices = config.voices
    ? [config.voice, config.voices.host, config.voices.guest]
    : [config.voice];
  if (config.provider === "local") {
    const readyIds = new Set(
      readiness.providers.local.voices.map((voice) => voice.id),
    );
    if (
      !readiness.providers.local.ready ||
      !configuredVoices.every((voice) => readyIds.has(voice))
    ) {
      return {
        ok: false,
        error: config.voices
          ? "Host and guest voices must both be ready local voices. Download another voice in Settings → Voice or use one voice for both speakers."
          : "The selected local voice is not ready. Download it in Settings → Voice or choose another ready voice.",
      };
    }
  } else {
    if (!readiness.providers.elevenlabs.ready) {
      return {
        ok: false,
        error: "Set ELEVENLABS_API_KEY in Vault settings before rendering.",
      };
    }
    if (!configuredVoices.every((voice) => isValidElevenLabsVoiceId(voice))) {
      return {
        ok: false,
        error: config.voices
          ? "Enter valid ElevenLabs voice ids for the host and guest voices."
          : "Enter a valid ElevenLabs voice id.",
      };
    }
  }

  if (kind !== "podcast" && !readiness.ffmpeg.ready) {
    return {
      ok: false,
      error:
        readiness.ffmpeg.hint ??
        "Install ffmpeg and ffprobe before rendering video.",
    };
  }
  return { ok: true };
}
