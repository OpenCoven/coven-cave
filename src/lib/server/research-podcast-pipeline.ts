import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchGenerationScriptSegment,
  type ResearchGenerationContent,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import {
  runKokoro,
  runPiper,
} from "../voice/local-tts-server.ts";
import { LOCAL_TTS_MAX_CHARS } from "../voice/local-tts.ts";
import {
  speechEnginesReadiness,
  speechModelById,
  withSpeechModelUse,
  type SpeechModelReadiness,
} from "../voice/speech-models.ts";
import { resolveSecret } from "../vault.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  isValidElevenLabsVoiceId,
} from "../voice/elevenlabs-shared.ts";
import {
  RESEARCH_AUDIO_MAX_BYTES,
  writeResearchGenerationMedia,
  removeResearchGenerationMedia,
} from "./research-media-store.ts";
import type { ResearchMediaJobDefinition } from "./research-media-job-contract.ts";

type PcmWav = {
  bytes: Uint8Array;
  dataOffset: number;
  dataLength: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  byteRate: number;
  blockAlign: number;
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function parsePcmWav(bytes: Uint8Array): PcmWav {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("TTS returned a non-PCM WAV file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + chunkLength;
    if (chunkEnd > bytes.length) throw new Error("TTS returned a truncated WAV file");
    if (ascii(bytes, offset, 4) === "fmt " && chunkLength >= 16) {
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        blockAlign: view.getUint16(offset + 20, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
      if (view.getUint16(offset + 8, true) !== 1) throw new Error("TTS returned a non-PCM WAV file");
    }
    if (ascii(bytes, offset, 4) === "data") {
      dataOffset = offset + 8;
      dataLength = chunkLength;
    }
    offset = chunkEnd + (chunkLength % 2);
  }
  if (!format || dataOffset < 0) throw new Error("TTS returned an incomplete WAV file");
  return { bytes, dataOffset, dataLength, ...format };
}

/** Concatenate PCM WAV payloads without requiring ffmpeg or another encoder. */
export function concatPcmWav(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) throw new Error("podcast has no synthesized segments");
  const parsed = chunks.map(parsePcmWav);
  const first = parsed[0];
  for (const current of parsed.slice(1)) {
    if (
      current.channels !== first.channels ||
      current.sampleRate !== first.sampleRate ||
      current.bitsPerSample !== first.bitsPerSample ||
      current.blockAlign !== first.blockAlign
    ) {
      throw new Error("TTS segments use incompatible WAV formats");
    }
  }
  const dataLength = parsed.reduce((total, current) => total + current.dataLength, 0);
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => output[offset + index] = char.charCodeAt(0));
  text(0, "RIFF");
  view.setUint32(4, output.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, first.byteRate, true);
  view.setUint16(32, first.blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  text(36, "data");
  view.setUint32(40, dataLength, true);
  let targetOffset = 44;
  for (const current of parsed) {
    output.set(current.bytes.subarray(current.dataOffset, current.dataOffset + current.dataLength), targetOffset);
    targetOffset += current.dataLength;
  }
  return output;
}

export function pcmWavDurationMs(bytes: Uint8Array): number {
  const parsed = parsePcmWav(bytes);
  return Math.round((parsed.dataLength / parsed.byteRate) * 1_000);
}

function readyVoice(voices: SpeechModelReadiness[], requestedVoice?: string): SpeechModelReadiness {
  const voice = requestedVoice
    ? voices.find((candidate) => candidate.id === requestedVoice && candidate.ready)
    : voices.find((candidate) => candidate.ready);
  if (!voice) {
    throw new Error("No verified local TTS voice is ready — download a local voice in Settings → Voice");
  }
  return voice;
}

async function synthesizeLocal(text: string, requestedVoice: string | undefined, signal: AbortSignal): Promise<{ bytes: Uint8Array; voice: string }> {
  const readiness = await speechEnginesReadiness();
  const voice = readyVoice(readiness.tts, requestedVoice);
  const model = speechModelById(voice.id);
  if (!model) throw new Error("the selected local TTS voice is not registered");
  const bytes = await withSpeechModelUse(model.id, async () => {
    if (model.engine === "piper") return runPiper(voice.path, text, signal);
    const companions = voice.companionPaths ?? [];
    if (companions.length < 2 || model.kokoroSpeakerId === undefined) {
      throw new Error("the selected Kokoro voice is incomplete");
    }
    return runKokoro({
      modelPath: voice.path,
      voicesPath: companions[0],
      tokensPath: companions[1],
      speakerId: model.kokoroSpeakerId,
    }, text, signal);
  });
  return { bytes, voice: voice.id };
}

function pcmToWav(pcm: Uint8Array, sampleRate = 16_000, channels = 1): Uint8Array {
  if (pcm.length === 0 || pcm.length % 2 !== 0) throw new Error("ElevenLabs returned empty PCM audio");
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

const ELEVENLABS_REQUEST_TIMEOUT_MS = 60_000;

export async function readBoundedElevenLabsAudio(
  response: Response,
  maxBytes = RESEARCH_AUDIO_MAX_BYTES - 44,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    throw new Error("ElevenLabs audio exceeds the size limit");
  }
  if (!response.body) throw new Error("ElevenLabs returned no audio body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("audio size limit exceeded").catch(() => {});
        throw new Error("ElevenLabs audio exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function synthesizeElevenLabs(
  text: string,
  requestedVoice: string | undefined,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; voice: string }> {
  const apiKey = resolveSecret("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in Vault settings.");
  const voice = requestedVoice ?? DEFAULT_ELEVENLABS_VOICE_ID;
  if (!isValidElevenLabsVoiceId(voice)) throw new Error("invalid ElevenLabs voice id");
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(ELEVENLABS_REQUEST_TIMEOUT_MS),
  ]);
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: DEFAULT_ELEVENLABS_MODEL_ID }),
      signal: requestSignal,
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs returned http ${response.status}`);
  const pcm = await readBoundedElevenLabsAudio(response);
  return { bytes: pcmToWav(pcm), voice };
}

/** Shared TTS seam for podcast audio and short-video voiceover. */
export async function synthesizeResearchPodcastSegment(
  text: string,
  provider: "local" | "elevenlabs",
  voice: string | undefined,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; voice: string }> {
  return provider === "local"
    ? synthesizeLocal(text, voice, signal)
    : synthesizeElevenLabs(text, voice, signal);
}

export type PodcastMediaJobInput = {
  familiarId: string;
  generationId: string;
  script: ResearchGenerationScriptSegment[];
  renderConfig: ResearchMediaRenderConfig;
};

export type PodcastPipelineDependencies = {
  synthesize?: (
    text: string,
    provider: ResearchMediaRenderConfig["provider"],
    voice: string,
    signal: AbortSignal,
  ) => Promise<{ bytes: Uint8Array; voice: string }>;
};

export function createPodcastMediaJobDefinition(
  input: PodcastMediaJobInput,
  dependencies: PodcastPipelineDependencies = {},
): ResearchMediaJobDefinition {
  const { provider, voice, voices, length } = input.renderConfig;
  const synthesize =
    dependencies.synthesize ?? synthesizeResearchPodcastSegment;
  const voiceForSegment = (segment: ResearchGenerationScriptSegment): string =>
    segment.speaker === "guest"
      ? (voices?.guest ?? voice)
      : segment.speaker === "host"
        ? (voices?.host ?? voice)
        : voice;
  return {
    familiarId: input.familiarId,
    generationId: input.generationId,
    async run(context) {
      await context.reportStage("scripting");
      const segments: Uint8Array[] = [];
      try {
        const maxCharacters =
          RESEARCH_MEDIA_LENGTH_LIMITS.podcast[length].maxCharacters;
        const scriptCharacters = input.script.reduce(
          (total, segment) => total + segment.text.length,
          0,
        );
        if (scriptCharacters > maxCharacters) {
          throw new Error(
            `${length} podcast character budget (${maxCharacters}) exceeded`,
          );
        }
        if (input.script.length === 0) {
          throw new Error("podcast script has no narration segments");
        }
        for (const [index, segment] of input.script.entries()) {
          if (
            !segment.text.trim() ||
            segment.text.length > LOCAL_TTS_MAX_CHARS
          ) {
            throw new Error(
              `podcast segment ${index + 1} must be between 1 and ${LOCAL_TTS_MAX_CHARS} characters`,
            );
          }
        }
        let cumulativeAudioBytes = 0;
        for (const [index, segment] of input.script.entries()) {
          if (
            context.signal.aborted ||
            context.isCancellationRequested()
          ) {
            throw new Error("podcast render cancelled");
          }
          await context.reportStage("synthesizing");
          const segmentVoice = voiceForSegment(segment);
          try {
            const synthesized = await synthesize(
              segment.text,
              provider,
              segmentVoice,
              context.signal,
            );
            if (synthesized.voice !== segmentVoice) {
              throw new Error(
                `selected ${provider} voice changed during synthesis`,
              );
            }
            cumulativeAudioBytes += synthesized.bytes.byteLength;
            if (cumulativeAudioBytes > RESEARCH_AUDIO_MAX_BYTES) {
              throw new Error("podcast audio exceeds the size limit");
            }
            segments.push(synthesized.bytes);
          } catch (error) {
            if (
              context.signal.aborted ||
              context.isCancellationRequested()
            ) {
              throw new Error("podcast render cancelled");
            }
            throw new Error(
              `podcast segment ${index + 1} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (
          context.signal.aborted ||
          context.isCancellationRequested()
        ) {
          throw new Error("podcast render cancelled");
        }
        await context.reportStage("encoding");
        const audioBytes = concatPcmWav(segments);
        const parsed = parsePcmWav(audioBytes);
        const durationMs = Math.round((parsed.dataLength / parsed.byteRate) * 1_000);
        const stored = await writeResearchGenerationMedia({
          familiarId: input.familiarId,
          generationId: input.generationId,
          key: "podcast.wav",
          mimeType: "audio/wav",
          bytes: audioBytes,
          durationMs,
        });
        if (
          context.signal.aborted ||
          context.isCancellationRequested()
        ) {
          await removeResearchGenerationMedia(input.familiarId, input.generationId);
          throw new Error("podcast render cancelled");
        }
        return {
          content: {
            kind: "podcast",
            script: input.script,
            audio: { ...stored, provider, voice },
          } satisfies ResearchGenerationContent,
        };
      } catch (error) {
        if (
          context.signal.aborted ||
          context.isCancellationRequested()
        ) {
          await removeResearchGenerationMedia(input.familiarId, input.generationId);
        }
        throw error;
      }
    },
  };
}
