import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchGenerationScriptSegment,
  type ResearchGenerationContent,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import {
  runKokoro,
  runPiper,
  type KokoroRunner,
  type PiperRunner,
} from "../voice/local-tts-server.ts";
import { LOCAL_TTS_MAX_CHARS } from "../voice/local-tts.ts";
import {
  resolveLocalTtsVoice,
  speechModelReadiness,
  withSpeechModelUse,
} from "../voice/speech-models.ts";
import { resolveSecret } from "../vault.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  isValidElevenLabsVoiceId,
  isValidElevenLabsSeed,
  modelSupportsRequestStitching,
  validateElevenLabsModelSettings,
  type ElevenLabsVoiceSettings,
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
  if (view.getUint32(4, true) !== bytes.length - 8) {
    throw new Error("TTS returned an invalid WAV container length");
  }
  let format: { channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;
  for (; offset + 8 <= bytes.length;) {
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + chunkLength;
    if (chunkEnd > bytes.length) throw new Error("TTS returned a truncated WAV file");
    if (ascii(bytes, offset, 4) === "fmt " && chunkLength >= 16) {
      if (format) throw new Error("TTS returned duplicate WAV format metadata");
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
      if (dataOffset >= 0) throw new Error("TTS returned duplicate WAV audio data");
      dataOffset = offset + 8;
      dataLength = chunkLength;
    }
    offset = chunkEnd + (chunkLength % 2);
  }
  if (offset !== bytes.length) throw new Error("TTS returned malformed WAV chunk padding");
  if (!format || dataOffset < 0) throw new Error("TTS returned an incomplete WAV file");
  if (
    ![1, 2].includes(format.channels) ||
    format.bitsPerSample !== 16 ||
    format.sampleRate < 8_000 || format.sampleRate > 48_000 ||
    format.blockAlign !== format.channels * 2 ||
    format.byteRate !== format.sampleRate * format.blockAlign ||
    dataLength === 0 || dataLength % format.blockAlign !== 0
  ) {
    throw new Error("TTS returned invalid or empty 16-bit PCM WAV metadata");
  }
  const durationMs = dataLength / format.byteRate * 1_000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("TTS returned invalid audio duration");
  }
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
  if (dataLength + 44 > RESEARCH_AUDIO_MAX_BYTES) throw new Error("podcast audio exceeds the size limit");
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

export const PODCAST_SAMPLE_RATE = 24_000;
export const PODCAST_SEGMENT_TIMEOUT_MS = 90_000;
const PODCAST_MAX_SEGMENTS = 128;
const PODCAST_SEGMENT_MAX_DURATION_MS = 300_000;
const PODCAST_PEAK_HEADROOM = 10 ** (-1 / 20) * 32_767;
const PODCAST_TARGET_ACTIVE_RMS = 10 ** (-20 / 20) * 32_767;
const PODCAST_MAX_GAIN = 10 ** (6 / 20);

/**
 * Bounded constant gain per turn, not compression or measured LUFS. The
 * active-sample RMS excludes silence; +/-6 dB gain and -1 dBFS sample-peak
 * headroom preserve within-turn dynamics without amplifying failed synthesis.
 */
export function preparePodcastPcmWav(bytes: Uint8Array, maxDurationMs = PODCAST_SEGMENT_MAX_DURATION_MS): Uint8Array {
  if (bytes.byteLength > RESEARCH_AUDIO_MAX_BYTES) throw new Error("podcast audio exceeds the size limit");
  const parsed = parsePcmWav(bytes);
  const durationMs = parsed.dataLength / parsed.byteRate * 1_000;
  if (durationMs < 100 || durationMs > maxDurationMs) {
    throw new Error("podcast audio duration is outside the usable segment range");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0;
  let squareSum = 0;
  let sum = 0;
  let active = 0;
  let clipped = 0;
  for (let offset = parsed.dataOffset; offset < parsed.dataOffset + parsed.dataLength; offset += 2) {
    const sample = view.getInt16(offset, true);
    const amplitude = Math.abs(sample);
    peak = Math.max(peak, amplitude);
    if (amplitude <= SILENCE_AMPLITUDE_THRESHOLD) continue;
    active += 1;
    squareSum += sample * sample;
    sum += sample;
    if (amplitude >= 32_767) clipped += 1;
  }
  if (active < parsed.sampleRate * parsed.channels * 0.02) {
    throw new Error("podcast audio is silent or contains too little audible signal");
  }
  const rms = Math.sqrt(squareSum / active);
  if (!Number.isFinite(rms) || Math.abs(sum / active) > rms * 0.9) {
    throw new Error("podcast audio contains unusable constant-level signal");
  }
  if (clipped / active > 0.01) {
    throw new Error("podcast audio is clipped; choose another voice or delivery before rendering again");
  }
  const gain = Math.min(
    PODCAST_MAX_GAIN,
    Math.max(1 / PODCAST_MAX_GAIN, PODCAST_TARGET_ACTIVE_RMS / rms),
    PODCAST_PEAK_HEADROOM / peak,
  );
  const output = bytes.slice();
  const target = new DataView(output.buffer, output.byteOffset, output.byteLength);
  for (let offset = parsed.dataOffset; offset < parsed.dataOffset + parsed.dataLength; offset += 2) {
    target.setInt16(offset, Math.round(view.getInt16(offset, true) * gain), true);
  }
  return trimPcmWavSilence(output);
}

// ── per-segment silence trimming (cave-8nndo) ────────────────────────────────
// TTS engines pad segments with long stretches of near-silence (Charm's
// re-review caught ~4.9s of dead air mid-episode). Each segment is trimmed
// before concatenation, keeping a short natural breath on both sides so turns
// don't slam into each other.

/** 16-bit amplitude below which a sample counts as silence (~ -44 dBFS). */
const SILENCE_AMPLITUDE_THRESHOLD = 200;
/** Silence kept before a segment's first audible frame. */
const MAX_LEADING_SILENCE_MS = 250;
/** Silence kept after a segment's last audible frame. */
const MAX_TRAILING_SILENCE_MS = 450;

/**
 * Trims leading/trailing silence from a 16-bit PCM WAV segment down to the
 * caps above. A wholly silent segment is left unmasked for the quality gate.
 */
export function trimPcmWavSilence(bytes: Uint8Array): Uint8Array {
  const parsed = parsePcmWav(bytes);
  const view = new DataView(parsed.bytes.buffer, parsed.bytes.byteOffset, parsed.bytes.byteLength);
  const frameBytes = parsed.blockAlign;
  const frameCount = parsed.dataLength / frameBytes;
  const audible = (frame: number): boolean => {
    const base = parsed.dataOffset + frame * frameBytes;
    for (let channel = 0; channel < parsed.channels; channel += 1) {
      if (Math.abs(view.getInt16(base + channel * 2, true)) > SILENCE_AMPLITUDE_THRESHOLD) {
        return true;
      }
    }
    return false;
  };
  let first = 0;
  while (first < frameCount && !audible(first)) first += 1;
  if (first === frameCount) return bytes;
  let last = frameCount - 1;
  while (last > first && !audible(last)) last -= 1;
  const framesPerMs = parsed.sampleRate / 1_000;
  const start = Math.max(0, first - Math.round(MAX_LEADING_SILENCE_MS * framesPerMs));
  const end = Math.min(frameCount, last + 1 + Math.round(MAX_TRAILING_SILENCE_MS * framesPerMs));
  if (start === 0 && end === frameCount) return bytes;
  const dataStart = parsed.dataOffset + start * frameBytes;
  const dataLength = (end - start) * frameBytes;
  const output = new Uint8Array(44 + dataLength);
  const headerView = new DataView(output.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => (output[offset + index] = char.charCodeAt(0)));
  text(0, "RIFF");
  headerView.setUint32(4, output.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  headerView.setUint32(16, 16, true);
  headerView.setUint16(20, 1, true);
  headerView.setUint16(22, parsed.channels, true);
  headerView.setUint32(24, parsed.sampleRate, true);
  headerView.setUint32(28, parsed.byteRate, true);
  headerView.setUint16(32, parsed.blockAlign, true);
  headerView.setUint16(34, parsed.bitsPerSample, true);
  text(36, "data");
  headerView.setUint32(40, dataLength, true);
  output.set(parsed.bytes.subarray(dataStart, dataStart + dataLength), 44);
  return output;
}

type LocalPodcastSynthesisDependencies = {
  readiness?: typeof speechModelReadiness;
  withModelUse?: typeof withSpeechModelUse;
  piper?: PiperRunner;
  kokoro?: KokoroRunner;
};

export async function synthesizeLocal(
  text: string,
  requestedVoice: string | undefined,
  signal: AbortSignal,
  dependencies: LocalPodcastSynthesisDependencies = {},
): Promise<{ bytes: Uint8Array; voice: string }> {
  signal.throwIfAborted();
  if (!requestedVoice) throw new Error("Select a registered local TTS voice before rendering.");
  const selected = resolveLocalTtsVoice(requestedVoice);
  if (!selected || selected.model.kind !== "tts") {
    throw new Error("the selected local TTS voice is not registered");
  }
  const model = selected.model;
  const bytes = await (dependencies.withModelUse ?? withSpeechModelUse)(model.id, async () => {
    signal.throwIfAborted();
    // Derived speakers share the base bundle. Verify it while removal is
    // excluded, immediately before opening its assets.
    const voice = await (dependencies.readiness ?? speechModelReadiness)(model);
    signal.throwIfAborted();
    if (
      !voice.ready || !voice.verified ||
      voice.id !== model.id || voice.kind !== "tts" || voice.engine !== model.engine
    ) {
      throw new Error("The selected local voice is not verified and ready. Download and verify it in Settings → Voice.");
    }
    if (model.engine === "piper") return (dependencies.piper ?? runPiper)(voice.path, text, signal);
    if (model.engine !== "kokoro") throw new Error("the selected local TTS engine is unavailable");
    const [voicesPath, tokensPath] = voice.companionPaths ?? [];
    if (!voicesPath || !tokensPath || selected.kokoroSpeakerId === null) {
      throw new Error("the selected Kokoro voice is incomplete");
    }
    return (dependencies.kokoro ?? runKokoro)({
      modelPath: voice.path,
      voicesPath,
      tokensPath,
      speakerId: selected.kokoroSpeakerId,
    }, text, signal);
  });
  signal.throwIfAborted();
  return { bytes, voice: requestedVoice };
}

function mpegFrame(bytes: Uint8Array, offset: number): { length: number; format: number } | null {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = bytes[offset + 2] >> 4;
  const rateIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrates = version === 3
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rate = [44_100, 48_000, 32_000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const length = Math.floor((version === 3 ? 144_000 : 72_000) * bitrates[bitrateIndex] / rate) + ((bytes[offset + 2] >> 1) & 1);
  return offset + length <= bytes.length ? { length, format: version * 4 + rateIndex } : null;
}

function adtsFrame(bytes: Uint8Array, offset: number): { length: number; format: number } | null {
  if (offset + 7 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) return null;
  const rateIndex = (bytes[offset + 2] >> 2) & 15;
  if (rateIndex >= 13) return null;
  const length = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
  const headerLength = (bytes[offset + 1] & 1) ? 7 : 9;
  return length >= headerLength && offset + length <= bytes.length
    ? { length, format: (bytes[offset + 2] & 0xfc) | (bytes[offset + 1] & 8) << 8 }
    : null;
}

function isEncodedAudio(bytes: Uint8Array): boolean {
  if (
    ascii(bytes, 0, 3) === "ID3" ||
    ["OggS", "fLaC", "RIFF", "RF64", "FORM", "caff", ".snd"].includes(ascii(bytes, 0, 4)) ||
    ascii(bytes, 4, 4) === "ftyp" ||
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
  ) return true;
  // A single MPEG/ADTS sync word is also a perfectly valid PCM sample.
  // Require two complete, adjacent frames with consistent encoding metadata.
  return [mpegFrame, adtsFrame].some((parseFrame) => {
    const first = parseFrame(bytes, 0);
    const second = first ? parseFrame(bytes, first.length) : null;
    return first !== null && second !== null && first.format === second.format;
  });
}

function pcmToWav(pcm: Uint8Array, sampleRate = 16_000, channels = 1): Uint8Array {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error("ElevenLabs returned empty or malformed raw PCM audio");
  }
  if (isEncodedAudio(pcm)) throw new Error("ElevenLabs returned encoded audio instead of raw PCM");
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

export function withPodcastAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("podcast request cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export async function readBoundedElevenLabsAudio(
  response: Response,
  maxBytes = RESEARCH_AUDIO_MAX_BYTES - 44,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    void response.body?.cancel("audio size limit exceeded").catch(() => {});
    throw new Error("ElevenLabs audio exceeds the size limit");
  }
  if (!response.body) throw new Error("ElevenLabs returned no audio body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const pending = reader.read();
      const { done, value } = await (signal ? withPodcastAbort(pending, signal) : pending);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel("audio size limit exceeded").catch(() => {});
        throw new Error("ElevenLabs audio exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    if (signal?.aborted) void reader.cancel("audio request cancelled").catch(() => {});
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

async function readBoundedResponsePrefix(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      signal?.throwIfAborted();
      const pending = reader.read();
      const { done, value } = await (signal ? withPodcastAbort(pending, signal) : pending);
      if (done) break;
      const remaining = maxBytes - size;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        size = maxBytes;
        void reader.cancel("response prefix limit reached").catch(() => {});
        break;
      }
      chunks.push(value);
      size += value.byteLength;
      if (size === maxBytes) {
        void reader.cancel("response prefix limit reached").catch(() => {});
        break;
      }
    }
  } finally {
    if (signal?.aborted) void reader.cancel("audio request cancelled").catch(() => {});
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

export type ElevenLabsSynthesisOptions = {
  /** Model id; callers default to `DEFAULT_ELEVENLABS_MODEL_ID`. */
  model?: string;
  /** Delivery controls; callers default to the shared baseline settings. */
  voiceSettings?: ElevenLabsVoiceSettings;
  /** The previous segment's text, for cross-segment prosody continuity. */
  previousText?: string;
  /** The next segment's text, for cross-segment prosody continuity. */
  nextText?: string;
  /** Pins provider sampling so two renders of the same script are comparable. */
  seed?: number;
  /** Opt-in podcast quality; existing video narration retains 16 kHz. */
  sampleRate?: 16_000 | 24_000;
  maxAudioBytes?: number;
};

export type ElevenLabsTtsBody = {
  text: string;
  model_id: string;
  voice_settings: {
    stability: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
    speed?: number;
  };
  previous_text?: string;
  next_text?: string;
  seed?: number;
};

/**
 * Build the ElevenLabs text-to-speech request body for one render segment.
 * Pure and exported so the body shape is unit-testable without a network call.
 */
export function buildElevenLabsTtsBody(
  text: string,
  options: {
    modelId?: string;
    voiceSettings?: ElevenLabsVoiceSettings;
    previousText?: string;
    nextText?: string;
    seed?: number;
  } = {},
): ElevenLabsTtsBody {
  const settings = options.voiceSettings ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS;
  const modelId = options.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID;
  const modelError = validateElevenLabsModelSettings(modelId, options.voiceSettings);
  if (modelError) throw new Error(modelError);
  const body: ElevenLabsTtsBody = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: settings.stability,
      ...(modelSupportsRequestStitching(modelId) ? {
        similarity_boost: settings.similarityBoost,
        style: settings.style,
        use_speaker_boost: settings.useSpeakerBoost,
        speed: settings.speed,
      } : {}),
    },
  };
  // Dropping unsupported context is the only degradation that keeps the render
  // alive: the provider rejects the entire request rather than ignoring it.
  if (modelSupportsRequestStitching(modelId)) {
    if (options.previousText) body.previous_text = options.previousText;
    if (options.nextText) body.next_text = options.nextText;
  }
  if (isValidElevenLabsSeed(options.seed)) body.seed = options.seed;
  return body;
}

/**
 * Read a bounded slice of a failed response so the thrown error names the
 * provider's actual complaint. A bare status turned an `invalid_parameters`
 * rejection into an unattributable "http 400" during triage.
 */
const ELEVENLABS_ERROR_DETAIL_MAX_CHARS = 300;
const ELEVENLABS_ERROR_DETAIL_MAX_BYTES = ELEVENLABS_ERROR_DETAIL_MAX_CHARS * 4;

export async function readElevenLabsErrorDetail(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    const raw = new TextDecoder().decode(
      await readBoundedResponsePrefix(response, ELEVENLABS_ERROR_DETAIL_MAX_BYTES, signal),
    );
    const detail = raw.replace(/\s+/g, " ").trim();
    if (!detail) return "";
    return detail.length > ELEVENLABS_ERROR_DETAIL_MAX_CHARS
      ? `${detail.slice(0, ELEVENLABS_ERROR_DETAIL_MAX_CHARS)}…`
      : detail;
  } catch {
    return "";
  }
}

async function synthesizeElevenLabs(
  text: string,
  requestedVoice: string | undefined,
  signal: AbortSignal,
  options: ElevenLabsSynthesisOptions = {},
): Promise<{ bytes: Uint8Array; voice: string }> {
  signal.throwIfAborted();
  const apiKey = resolveSecret("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in Vault settings.");
  const voice = requestedVoice ?? DEFAULT_ELEVENLABS_VOICE_ID;
  if (!isValidElevenLabsVoiceId(voice)) throw new Error("invalid ElevenLabs voice id");
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(ELEVENLABS_REQUEST_TIMEOUT_MS),
  ]);
  const sampleRate = options.sampleRate ?? 16_000;
  if (sampleRate !== 16_000 && sampleRate !== 24_000) throw new Error("unsupported speech sample rate");
  const response = await withPodcastAbort(fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_${sampleRate}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildElevenLabsTtsBody(text, {
        modelId: options.model,
        voiceSettings: options.voiceSettings,
        previousText: options.previousText,
        nextText: options.nextText,
        seed: options.seed,
      })),
      signal: requestSignal,
    },
  ), requestSignal);
  if (!response.ok) {
    const detail = await readElevenLabsErrorDetail(response, requestSignal);
    requestSignal.throwIfAborted();
    throw new Error(
      `ElevenLabs returned http ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType && !["application/octet-stream", "audio/pcm", "audio/x-pcm"].includes(contentType)) {
    void response.body?.cancel("unexpected audio format").catch(() => {});
    throw new Error("ElevenLabs returned an incompatible content type; raw PCM audio is required");
  }
  const pcm = await readBoundedElevenLabsAudio(response, options.maxAudioBytes, requestSignal);
  requestSignal.throwIfAborted();
  return { bytes: pcmToWav(pcm, sampleRate), voice };
}

/** Shared TTS seam for podcast audio and short-video voiceover. */
export async function synthesizeResearchPodcastSegment(
  text: string,
  provider: "local" | "elevenlabs",
  voice: string | undefined,
  signal: AbortSignal,
  options: ElevenLabsSynthesisOptions = {},
): Promise<{ bytes: Uint8Array; voice: string }> {
  signal.throwIfAborted();
  return provider === "local"
    ? synthesizeLocal(text, voice, signal)
    : synthesizeElevenLabs(text, voice, signal, options);
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
    options?: ElevenLabsSynthesisOptions,
  ) => Promise<{ bytes: Uint8Array; voice: string }>;
};

export const PODCAST_PREVIEW_TEXT =
  "Welcome. Here is a short voice preview. We will explore a question, compare the evidence, and leave room for what we do not yet know.";
export const PODCAST_PREVIEW_TIMEOUT_MS = 30_000;
const PODCAST_PREVIEW_MAX_BYTES = PODCAST_SAMPLE_RATE * 2 * 30;

function podcastSynthesisOptions(config: ResearchMediaRenderConfig): ElevenLabsSynthesisOptions {
  return {
    model: config.model ?? DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
    voiceSettings: config.voiceSettings,
    sampleRate: PODCAST_SAMPLE_RATE,
    ...(config.seed !== undefined ? { seed: config.seed } : {}),
  };
}

/** Same synthesis and level preparation as a render; never writes media/jobs. */
export async function synthesizeResearchPodcastPreview(
  config: ResearchMediaRenderConfig,
  signal: AbortSignal,
  dependencies: PodcastPipelineDependencies = {},
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const modelError = config.provider === "elevenlabs"
    ? validateElevenLabsModelSettings(config.model ?? DEFAULT_ELEVENLABS_PODCAST_MODEL_ID, config.voiceSettings)
    : null;
  if (modelError) throw new Error(modelError);
  const result = await withPodcastAbort(
    (dependencies.synthesize ?? synthesizeResearchPodcastSegment)(
      PODCAST_PREVIEW_TEXT,
      config.provider,
      config.voice,
      signal,
      { ...podcastSynthesisOptions(config), maxAudioBytes: PODCAST_PREVIEW_MAX_BYTES },
    ),
    signal,
  );
  signal.throwIfAborted();
  if (result.voice !== config.voice) throw new Error("selected voice changed during synthesis");
  return preparePodcastPcmWav(result.bytes, 30_000);
}

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
        if (provider === "elevenlabs") {
          const modelError = validateElevenLabsModelSettings(
            input.renderConfig.model ?? DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
            input.renderConfig.voiceSettings,
          );
          if (modelError) throw new Error(modelError);
        }
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
        if (input.script.length > PODCAST_MAX_SEGMENTS) {
          throw new Error(`podcast script exceeds the ${PODCAST_MAX_SEGMENTS} segment limit`);
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
          if (cumulativeAudioBytes + 44 >= RESEARCH_AUDIO_MAX_BYTES) {
            throw new Error("podcast audio exceeds the size limit");
          }
          await context.reportStage("synthesizing");
          context.signal.throwIfAborted();
          if (context.isCancellationRequested()) throw new Error("podcast render cancelled");
          const segmentVoice = voiceForSegment(segment);
          try {
            const segmentSignal = AbortSignal.any([
              context.signal,
              AbortSignal.timeout(PODCAST_SEGMENT_TIMEOUT_MS),
            ]);
            const synthesized = await withPodcastAbort(synthesize(
              segment.text,
              provider,
              segmentVoice,
              segmentSignal,
              {
                ...podcastSynthesisOptions(input.renderConfig),
                previousText: input.script[index - 1]?.text,
                nextText: input.script[index + 1]?.text,
                maxAudioBytes: Math.min(
                  RESEARCH_AUDIO_MAX_BYTES - cumulativeAudioBytes - 44,
                  PODCAST_SEGMENT_MAX_DURATION_MS / 1_000 * PODCAST_SAMPLE_RATE * 2,
                ),
              },
            ), segmentSignal);
            segmentSignal.throwIfAborted();
            if (context.isCancellationRequested()) throw new Error("podcast render cancelled");
            if (synthesized.voice !== segmentVoice) {
              throw new Error(
                `selected ${provider} voice changed during synthesis`,
              );
            }
            cumulativeAudioBytes += synthesized.bytes.byteLength;
            if (cumulativeAudioBytes > RESEARCH_AUDIO_MAX_BYTES) {
              throw new Error("podcast audio exceeds the size limit");
            }
            segments.push(preparePodcastPcmWav(synthesized.bytes));
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
        context.signal.throwIfAborted();
        if (context.isCancellationRequested()) throw new Error("podcast render cancelled");
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
