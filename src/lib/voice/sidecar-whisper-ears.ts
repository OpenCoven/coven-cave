// Browser-side ears for the local whisper.cpp sidecar.
//
// whisper.cpp's CLI has a stable WAV input contract, so capture is PCM via
// WebAudio rather than MediaRecorder's browser-specific WebM/MP4 codecs. The
// endpoint is deliberately one utterance at a time: local VAD endpointing
// keeps the sidecar CPU work bounded and gives the speech loop the same
// listen -> final -> restart cadence as native-stt.

import type { SpeechEars, SpeechEarsFactory, SpeechEarsHandlers } from "./speech-loop.ts";

export const SIDECAR_WHISPER_ENDPOINT = "/api/voice/engines/whisper";
export const WHISPER_SILENCE_MS = 1_200;
export const WHISPER_MAX_UTTERANCE_MS = 30_000;
export const WHISPER_VOICE_THRESHOLD = 0.012;
export const WHISPER_SAMPLE_RATE = 16_000;
export const WHISPER_PARTIAL_MS = 600;

type EnginesPayload = {
  ok?: boolean;
  stt?: Array<{ engine?: string; ready?: boolean }>;
};

type WhisperResponse = {
  ok?: boolean;
  session?: number;
  kind?: "partial" | "final";
  text?: string;
  error?: string;
  hint?: string;
};

type TimerOptions = {
  stabilityMs?: number;
  maxUtteranceMs?: number;
  voiceThreshold?: number;
  fetchImpl?: typeof fetch;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

type AudioContextConstructor = new () => AudioContext;

/** True only for a verified downloaded Whisper model advertised by the sidecar. */
export async function sidecarWhisperAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/voice/engines", { cache: "no-store" });
    if (!res.ok) return false;
    const payload = await res.json() as EnginesPayload;
    return payload.ok === true && payload.stt?.some(
      (model) => model.engine === "whisper" && model.ready === true,
    ) === true;
  } catch {
    return false;
  }
}

/** Encode mono float PCM into the 16-bit WAV accepted directly by whisper.cpp. */
export function encodePcmWav(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const clamped = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

/** whisper.cpp accepts 16 kHz WAV input. Browser contexts normally run at
 *  44.1/48 kHz, so downsample the captured mono PCM before serialization. */
export function resampleMonoPcm(
  chunks: readonly Float32Array[],
  sourceRate: number,
  targetRate: number = WHISPER_SAMPLE_RATE,
): Float32Array {
  const inputLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  if (sourceRate === targetRate || inputLength === 0) return input;
  const output = new Float32Array(Math.max(1, Math.round(inputLength * targetRate / sourceRate)));
  for (let index = 0; index < output.length; index++) {
    const sourceIndex = index * sourceRate / targetRate;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, input.length - 1);
    const fraction = sourceIndex - lower;
    output[index] = input[lower] * (1 - fraction) + input[upper] * fraction;
  }
  return output;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const legacy = window as unknown as { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? legacy.webkitAudioContext ?? null;
}

/**
 * Ears factory selected before the loop connects. The microphone is supplied
 * by connectSpeechLoop so this adapter neither requests a second permission
 * nor owns track lifetime.
 */
export function createSidecarWhisperEars(options: TimerOptions = {}): SpeechEarsFactory {
  const stabilityMs = options.stabilityMs ?? WHISPER_SILENCE_MS;
  const maxUtteranceMs = options.maxUtteranceMs ?? WHISPER_MAX_UTTERANCE_MS;
  const threshold = options.voiceThreshold ?? WHISPER_VOICE_THRESHOLD;
  const request = options.fetchImpl ?? fetch;
  const schedule = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const unschedule = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as number));

  return (handlers: SpeechEarsHandlers, mic?: MediaStream): SpeechEars => {
    let wanted = false;
    let closed = false;
    let current = 0;
    let counter = 0;
    let stabilityTimer: unknown = null;
    let capTimer: unknown = null;
    let partialTimer: unknown = null;
    let controller: AbortController | null = null;
    let partialController: AbortController | null = null;
    let partialInFlight = false;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silentOutput: GainNode | null = null;
    let chunks: Float32Array[] = [];
    let hasSpeech = false;

    const clearTimers = () => {
      if (stabilityTimer !== null) { unschedule(stabilityTimer); stabilityTimer = null; }
      if (capTimer !== null) { unschedule(capTimer); capTimer = null; }
      if (partialTimer !== null) { unschedule(partialTimer); partialTimer = null; }
    };

    const releaseCapture = () => {
      processor?.disconnect();
      source?.disconnect();
      silentOutput?.disconnect();
      processor = null;
      source = null;
      silentOutput = null;
      const oldContext = context;
      context = null;
      if (oldContext && oldContext.state !== "closed") void oldContext.close().catch(() => { /* teardown */ });
    };

    const restart = () => {
      if (wanted && !closed) start();
    };

    const postAudio = (
      session: number,
      audio: readonly Float32Array[],
      sampleRate: number,
      kind: "partial" | "final",
      signal: AbortSignal,
    ) => {
      const wav = encodePcmWav([resampleMonoPcm(audio, sampleRate)], WHISPER_SAMPLE_RATE);
      const form = new FormData();
      form.set("session", String(session));
      form.set("kind", kind);
      const wavBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
      form.set("audio", new Blob([wavBuffer], { type: "audio/wav" }), "utterance.wav");
      return request(SIDECAR_WHISPER_ENDPOINT, { method: "POST", body: form, signal })
        .then(async (res) => ({ res, body: await res.json().catch(() => null) as WhisperResponse | null }));
    };

    const sendPartial = (session: number) => {
      if (closed || !wanted || current !== session || partialInFlight || chunks.length === 0) return;
      const partialAudio = chunks.slice();
      const sampleRate = context?.sampleRate ?? WHISPER_SAMPLE_RATE;
      const requestController = new AbortController();
      partialController = requestController;
      partialInFlight = true;
      void postAudio(session, partialAudio, sampleRate, "partial", requestController.signal)
        .then(({ res, body }) => {
          if (closed || requestController.signal.aborted || current !== session) return;
          if (!res.ok || !body?.ok || body.session !== session || body.kind !== "partial") {
            // An early incremental decode can legitimately contain no complete
            // words yet. Keep collecting; the final decode remains authoritative.
            if (body?.error === "whisper_empty") return;
            wanted = false;
            handlers.onError(body?.error ?? "whisper_failed", body?.hint);
            return;
          }
          const text = body.text?.trim();
          if (text) handlers.onPartial(text);
        })
        .catch((error) => {
          if (closed || requestController.signal.aborted) return;
          wanted = false;
          handlers.onError("whisper_unavailable", error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          partialInFlight = false;
          if (partialController === requestController) partialController = null;
        });
    };

    const finish = (session: number) => {
      if (closed || session !== current) return;
      clearTimers();
      current = 0;
      const sampleRate = context?.sampleRate ?? 16_000;
      releaseCapture();
      const audio = chunks;
      chunks = [];
      if (!hasSpeech || audio.length === 0) { restart(); return; }
      hasSpeech = false;
      const requestController = new AbortController();
      controller = requestController;
      void postAudio(session, audio, sampleRate, "final", requestController.signal)
        .then(({ res, body }) => {
          if (closed || requestController.signal.aborted) return;
          if (!res.ok || !body?.ok || body.session !== session || body.kind !== "final") {
            // Match native STT's empty-final behavior: resume listening rather
            // than turning a pause or an unrecognized sound into a call error.
            if (body?.error === "whisper_empty") { restart(); return; }
            wanted = false;
            handlers.onError(body?.error ?? "whisper_failed", body?.hint);
            return;
          }
          const text = body.text?.trim();
          if (text) handlers.onFinal(text);
          restart();
        })
        .catch((error) => {
          if (closed || requestController.signal.aborted) return;
          wanted = false;
          handlers.onError("whisper_unavailable", error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (controller === requestController) controller = null;
        });
    };

    const start = () => {
      if (closed || !wanted || current !== 0) return;
      if (!mic) {
        wanted = false;
        handlers.onError("whisper_unavailable", "The local Whisper engine could not access the microphone stream.");
        return;
      }
      const Context = audioContextConstructor();
      if (!Context) {
        wanted = false;
        handlers.onError("whisper_unavailable", "This browser cannot capture PCM audio for local Whisper.");
        return;
      }
      const session = ++counter;
      current = session;
      chunks = [];
      hasSpeech = false;
      context = new Context();
      source = context.createMediaStreamSource(mic);
      processor = context.createScriptProcessor(4_096, 1, 1);
      // A zero-gain output keeps ScriptProcessor active without feeding the mic
      // back to the speakers.
      silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (closed || current !== session) return;
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(input.slice());
        if (rms(input) < threshold) return;
        hasSpeech = true;
        if (stabilityTimer !== null) unschedule(stabilityTimer);
        stabilityTimer = schedule(() => finish(session), stabilityMs);
        if (capTimer === null) capTimer = schedule(() => finish(session), maxUtteranceMs);
        if (partialTimer === null && !partialInFlight) {
          partialTimer = schedule(() => {
            partialTimer = null;
            sendPartial(session);
          }, WHISPER_PARTIAL_MS);
        }
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(context.destination);
      void context.resume().catch(() => { /* user gesture is supplied by call start */ });
    };

    const stop = () => {
      clearTimers();
      current = 0;
      releaseCapture();
      chunks = [];
      hasSpeech = false;
      controller?.abort();
      controller = null;
      partialController?.abort();
      partialController = null;
    };

    return {
      listen() { wanted = true; start(); },
      hush() { wanted = false; stop(); },
      close() { closed = true; wanted = false; stop(); },
    };
  };
}
