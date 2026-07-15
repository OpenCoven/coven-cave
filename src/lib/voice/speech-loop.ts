// Shared client speech loop — the ears and mouth of a decomposed voice call.
//
// The local provider (local-loop.ts) established the shape: a voice call is
// ears (a swappable SpeechEars engine) → brain (a swappable async turn) →
// mouth (speechSynthesis), half-duplex so the mic never transcribes the
// synthesizer. This module extracts that scaffold so any brain can plug in:
//
//   local     — POST /api/voice/local/chat (loopback Ollama / LM Studio)
//   familiar  — a real chat turn through the familiar's own harness runtime
//               (familiar-brain.ts), the "true voice" mode
//
// Ears default to WebSpeech (SpeechRecognition, Chromium web builds); the
// Tauri shell swaps in the native macOS engine (native-stt.ts) because
// WKWebView ships no recognition engine.
//
// The mouth is an utterance QUEUE, not a single call: a streaming brain can
// speak sentence-chunks as they arrive (latency win — the familiar starts
// talking before the harness turn finishes) while recognition stays hushed
// until the whole queue drains.

import type { LiveSession, VoiceCallbacks } from "./types.ts";
import { VoiceConnectError } from "./types.ts";

/** One user turn in → the full final reply text out. Implementations may call
 *  `speak(chunk)` zero or more times to voice partial sentences as they
 *  stream; whatever final text remains unspoken is voiced by the loop. Throw
 *  a VoiceConnectError to surface a call problem without ending the call. */
export type SpeechBrain = (
  userText: string,
  speak: (chunk: string) => void,
) => Promise<string>;

/** The mouth half of the loop: voice one utterance, resolving when playback
 *  finishes. `cancel()` stops playback immediately (call ending). The default
 *  mouth is the system synthesizer; ElevenLabs plugs in a network mouth. */
export type SpeechMouth = {
  speak(text: string): Promise<void>;
  cancel(): void;
};

/** The system speechSynthesis mouth — AVSpeechSynthesizer voices on macOS
 *  WebViews. `voiceName` picks a system voice; empty means platform default.
 *  Environments without speechSynthesis resolve immediately (silent). */
export function createSystemSynthMouth(voiceName?: string): SpeechMouth {
  return {
    speak(text: string) {
      return new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        if (voiceName) {
          const match = window.speechSynthesis
            .getVoices()
            .find((v) => v.name === voiceName);
          if (match) utterance.voice = match;
        }
        const done = () => resolve();
        utterance.onend = done;
        utterance.onerror = done;
        window.speechSynthesis.speak(utterance);
      });
    },
    cancel() {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
  };
}

/** Minimum characters before a sentence break is worth voicing on its own —
 *  keeps list markers ("1.") and initials from becoming tiny utterances. */
export const MIN_SPOKEN_SENTENCE_CHARS = 24;

const SENTENCE_BREAK = /[.!?…][)"'\u201d\u2019]?\s+/g;

/**
 * Incremental sentence chunker for a streaming reply. Feed it the ACCUMULATED
 * visible text after each stream event; it returns any newly completed
 * sentences (each ending at a sentence break) exactly once. `flush()` returns
 * the unterminated tail. Pure and stateful-by-instance, so it is unit-testable
 * without a synthesizer.
 */
export function createSentenceChunker(minChars: number = MIN_SPOKEN_SENTENCE_CHARS) {
  let emitted = 0;
  return {
    push(accumulated: string): string[] {
      const out: string[] = [];
      SENTENCE_BREAK.lastIndex = emitted;
      let match: RegExpExecArray | null;
      while ((match = SENTENCE_BREAK.exec(accumulated)) !== null) {
        const end = match.index + match[0].length;
        const chunk = accumulated.slice(emitted, end).trim();
        if (chunk.length >= minChars) {
          out.push(chunk);
          emitted = end;
        }
        // A too-short fragment stays buffered; it rides with the next break.
      }
      return out;
    },
    flush(accumulated: string): string | null {
      const tail = accumulated.slice(emitted).trim();
      emitted = accumulated.length;
      return tail.length > 0 ? tail : null;
    },
  };
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export function resolveSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export const STT_UNAVAILABLE_HINT =
  "This window has no speech recognition engine. The desktop app hears through native macOS recognition; on the web this voice mode needs a Chromium browser. The sidecar Whisper engine is on the roadmap — or pick a cloud voice provider in Familiar Studio → Brain.";

/** Callbacks the loop hands to an ears implementation. */
export type SpeechEarsHandlers = {
  onPartial(text: string): void;
  onFinal(text: string): void;
  /** Non-routine engine failure; surfaced to the call as a VoiceConnectError. */
  onError(code: string, hint?: string): void;
};

/** The ears half of the loop — a swappable capture+transcribe engine.
 *  `listen()` and `hush()` are idempotent; the loop owns WHEN to listen
 *  (half-duplex policy), the ears own HOW (WebSpeech today, the native
 *  macOS SFSpeechRecognizer engine in the Tauri shell, sidecar Whisper
 *  later). An ears implementation that stops itself (silence timeouts,
 *  one-shot recognition tasks) must restart while it is in the listening
 *  state, and must never restart after `hush()`/`close()`. */
export type SpeechEars = {
  listen(): void;
  hush(): void;
  close(): void;
};

export type SpeechEarsFactory = (handlers: SpeechEarsHandlers) => SpeechEars;

/** WebSpeech ears — SpeechRecognition where the WebView has it (Chromium
 *  web builds). Returns null when this window has no engine. */
export function createWebSpeechEars(): SpeechEarsFactory | null {
  const Recognition = resolveSpeechRecognition();
  if (!Recognition) return null;
  return (handlers) => {
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    let wanted = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript.trim()) continue;
        if (result.isFinal) handlers.onFinal(transcript.trim());
        else handlers.onPartial(transcript);
      }
    };
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are routine pauses, not call failures.
      if (event.error === "no-speech" || event.error === "aborted") return;
      handlers.onError(`stt_${event.error ?? "failed"}`);
    };
    // Recognition engines stop themselves after silence — keep listening.
    recognition.onend = () => {
      if (wanted) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    return {
      listen() {
        wanted = true;
        try { recognition.start(); } catch { /* already started */ }
      },
      hush() {
        wanted = false;
        try { recognition.stop(); } catch { /* already stopped */ }
      },
      close() {
        wanted = false;
        recognition.onend = null;
        try { recognition.stop(); } catch { /* already stopped */ }
      },
    };
  };
}

export type SpeechLoopOptions = {
  mic: MediaStream;
  /** System synthesizer voice name; empty for the platform default. Ignored
   *  when a custom `mouth` is supplied. */
  voiceName?: string;
  /** Custom mouth (e.g. ElevenLabs TTS). Defaults to the system synthesizer. */
  mouth?: SpeechMouth;
  /** Custom ears (e.g. the native macOS engine). Defaults to WebSpeech. */
  ears?: SpeechEarsFactory;
  callbacks: VoiceCallbacks;
  brain: SpeechBrain;
  /** Machine code reported when the brain throws a non-VoiceConnectError. */
  brainErrorCode: string;
  /** Human hint paired with `brainErrorCode`. */
  brainErrorHint: string;
};

/**
 * Wire ears → brain → mouth into a LiveSession. Throws VoiceConnectError
 * (`stt_unavailable`) when no ears are supplied and the WebView has no
 * recognition engine.
 */
export function connectSpeechLoop(opts: SpeechLoopOptions): LiveSession {
  const earsFactory = opts.ears ?? createWebSpeechEars();
  if (!earsFactory) {
    throw new VoiceConnectError("stt_unavailable", STT_UNAVAILABLE_HINT);
  }
  const { mic, callbacks } = opts;
  const mouth = opts.mouth ?? createSystemSynthMouth(opts.voiceName);

  let closed = false;
  let muted = false;
  let brainBusy = false;
  const pendingUser: string[] = [];

  // ── Mouth: a draining utterance queue (half-duplex with the ears) ──────────
  const utterances: string[] = [];
  let speaking = false;
  let onQueueDrained: (() => void) | null = null;

  const ears = earsFactory({
    onPartial: (text) => {
      if (!closed) callbacks.onPartialTranscript("user", text);
    },
    onFinal: (text) => {
      if (closed || !text.trim()) return;
      const trimmed = text.trim();
      callbacks.onUserTranscriptFinal(trimmed);
      void askBrain(trimmed);
    },
    onError: (code, hint) => {
      if (!closed) callbacks.onError(new VoiceConnectError(code, hint));
    },
  });

  const listen = () => {
    if (closed || muted || speaking) return;
    ears.listen();
  };
  const hush = () => {
    ears.hush();
  };

  const speakNext = () => {
    if (closed) {
      utterances.length = 0;
      speaking = false;
      onQueueDrained?.();
      return;
    }
    const text = utterances.shift();
    if (text === undefined) {
      speaking = false;
      onQueueDrained?.();
      listen();
      return;
    }
    speaking = true;
    hush();
    mouth
      .speak(text)
      .catch((err) => {
        // A mouth failure (e.g. the TTS proxy erroring) surfaces like a brain
        // failure but keeps draining — one bad utterance must not end the call.
        if (!closed) {
          callbacks.onError(
            err instanceof VoiceConnectError
              ? err
              : new VoiceConnectError(opts.brainErrorCode, opts.brainErrorHint),
          );
        }
      })
      .then(() => { speakNext(); });
  };

  const enqueueSpeech = (chunk: string) => {
    const text = chunk.trim();
    if (!text || closed) return;
    utterances.push(text);
    if (!speaking) speakNext();
  };

  /** Resolves once every queued utterance has been voiced. */
  const queueDrained = () =>
    new Promise<void>((resolve) => {
      if (!speaking && utterances.length === 0) { resolve(); return; }
      onQueueDrained = () => { onQueueDrained = null; resolve(); };
    });

  // ── Brain: one turn at a time; later finals wait their turn ────────────────
  const askBrain = async (userText: string): Promise<void> => {
    if (closed) return;
    if (brainBusy) {
      pendingUser.push(userText);
      return;
    }
    brainBusy = true;
    try {
      const finalText = await opts.brain(userText, enqueueSpeech);
      if (closed) return;
      callbacks.onAssistantTranscriptFinal(finalText);
      await queueDrained();
    } catch (err) {
      if (!closed) {
        callbacks.onError(
          err instanceof VoiceConnectError
            ? err
            : new VoiceConnectError(opts.brainErrorCode, opts.brainErrorHint),
        );
      }
    } finally {
      brainBusy = false;
      const next = pendingUser.shift();
      if (next && !closed) void askBrain(next);
    }
  };

  // ── Ears ───────────────────────────────────────────────────────────────────
  listen();

  return {
    // The mouth is the system synthesizer, not a network audio track — the
    // overlay's <audio> element gets a valid, silent stream. (Guarded for
    // non-browser environments, where no element will ever play it.)
    inboundAudio:
      typeof MediaStream === "undefined" ? ({} as MediaStream) : new MediaStream(),
    setMuted(next: boolean) {
      muted = next;
      for (const track of mic.getAudioTracks()) track.enabled = !next;
      if (next) hush();
      else listen();
    },
    async close() {
      closed = true;
      ears.close();
      utterances.length = 0;
      mouth.cancel();
      for (const track of mic.getAudioTracks()) track.stop();
    },
  };
}
