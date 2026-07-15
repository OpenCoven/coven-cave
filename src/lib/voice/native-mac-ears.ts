// Native macOS ears for the speech loop — SFSpeechRecognizer via Tauri
// (cave-0ogg).
//
// The desktop shell's WKWebView has no Web Speech `SpeechRecognition`, so
// the keyless voice modes (local / familiar / ElevenLabs) were deaf in the
// packaged app. These ears listen the only way a webview can without a
// cloud key: watch the mic's energy with an AnalyserNode (a small VAD gate),
// record each utterance with MediaRecorder (AAC in an mp4 container on
// WKWebView), and hand every finished segment to the `speech_stt_transcribe`
// Tauri command, where Apple's Speech framework transcribes it strictly
// on-device (`requiresOnDeviceRecognition` — audio never leaves the Mac).
//
// No partial transcripts: the loop only acts on finals, and per-utterance
// file recognition is how the OS ships dictation for exactly this shape.
// Streaming partials belong to the sidecar Whisper engine (cave-vony).

import { VoiceConnectError } from "./types.ts";
import type { SpeechEars, SpeechEarsCallbacks } from "./speech-loop.ts";

/** True where the native macOS engine is even a candidate: a Tauri shell on
 *  a Mac (iOS WebKit UAs contain "like Mac OS X", so exclude mobile — the
 *  mobile shell registers no speech commands). */
export function nativeMacSttCandidate(): boolean {
  if (typeof window === "undefined") return false;
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.userAgent || nav.platform || "";
  if (/iPhone|iPad|iPod/i.test(platform)) return false;
  return /Mac/i.test(platform);
}

/** Containers AVFoundation can open, most-preferred first. WKWebView records
 *  AAC-in-mp4; webm is deliberately absent — the recognizer can't read it. */
export const RECORDER_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
] as const;

export function pickRecorderMime(
  isSupported: (type: string) => boolean,
): string | null {
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // A throwing probe counts as unsupported.
    }
  }
  return null;
}

/** Split a Rust-command error string ("machine_code: human hint") into a
 *  VoiceConnectError; anything shapeless becomes stt_native_failed. */
export function parseNativeSttError(message: string): VoiceConnectError {
  const match = /^([a-z0-9_]+):\s*([\s\S]*)$/.exec(message.trim());
  if (match) {
    return new VoiceConnectError(match[1], match[2] || undefined);
  }
  return new VoiceConnectError("stt_native_failed", message.trim() || undefined);
}

// ── VAD gate: a pure utterance segmenter over mic RMS samples ───────────────

export type VadGateOptions = {
  /** RMS at or above this begins an utterance (enter threshold). */
  speechRms?: number;
  /** RMS at or above this keeps an utterance alive (stay threshold —
   *  lower than `speechRms` for hysteresis). */
  silenceRms?: number;
  /** Trailing silence that ends an utterance. */
  hangoverMs?: number;
  /** Utterances with less voiced span than this are discarded as noise. */
  minSpeechMs?: number;
  /** Hard cut so a droning environment can't record forever. */
  maxUtteranceMs?: number;
};

export type VadEvent = "idle" | "speaking" | "end" | "end-discard";

export const VAD_DEFAULTS: Required<VadGateOptions> = {
  speechRms: 0.02,
  silenceRms: 0.012,
  hangoverMs: 900,
  minSpeechMs: 250,
  maxUtteranceMs: 45_000,
};

/** Feed `push(rms, nowMs)` on every poll; it reports when an utterance ends
 *  ("end" → transcribe the recorded window, "end-discard" → too short, drop
 *  it). Pure and instance-stateful, so it is unit-testable without audio. */
export function createVadGate(options: VadGateOptions = {}) {
  const opts = { ...VAD_DEFAULTS, ...options };
  let speaking = false;
  let speechStart = 0;
  let lastVoice = 0;
  return {
    push(rms: number, nowMs: number): VadEvent {
      if (!speaking) {
        if (rms >= opts.speechRms) {
          speaking = true;
          speechStart = nowMs;
          lastVoice = nowMs;
          return "speaking";
        }
        return "idle";
      }
      if (rms >= opts.silenceRms) lastVoice = nowMs;
      if (nowMs - speechStart >= opts.maxUtteranceMs) {
        speaking = false;
        return "end";
      }
      if (nowMs - lastVoice >= opts.hangoverMs) {
        speaking = false;
        return lastVoice - speechStart >= opts.minSpeechMs ? "end" : "end-discard";
      }
      return "speaking";
    },
    reset() {
      speaking = false;
    },
  };
}

// ── The ears themselves ─────────────────────────────────────────────────────

type SttProbe = {
  supported: boolean;
  status: string;
  onDevice: boolean;
  locale?: string | null;
  detail?: string | null;
};

const VAD_POLL_MS = 100;
/** Restart an idle (speech-free) recording window so silence never
 *  accumulates into an unbounded in-memory blob. */
const IDLE_RESTART_MS = 20_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("segment_read_failed"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : "");
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Build the native macOS ears. Probes authorization + on-device support up
 * front (the system permission sheet appears here on first use) so a call
 * that can't hear fails at connect time with an actionable hint.
 */
export async function createNativeMacEars(
  mic: MediaStream,
  callbacks: SpeechEarsCallbacks,
): Promise<SpeechEars> {
  const { invoke } = await import("@tauri-apps/api/core");
  const locale =
    typeof navigator !== "undefined" ? navigator.language || undefined : undefined;

  let probe: SttProbe;
  try {
    probe = await invoke<SttProbe>("speech_stt_probe", { locale });
  } catch (e) {
    throw parseNativeSttError(e instanceof Error ? e.message : String(e));
  }
  if (!probe.supported) {
    throw new VoiceConnectError(
      "stt_unavailable",
      probe.detail ?? "native speech recognition is not available on this platform",
    );
  }
  if (probe.status === "denied" || probe.status === "restricted") {
    throw new VoiceConnectError(
      "stt_permission_denied",
      "macOS blocked speech recognition for CovenCave — allow it under System Settings → Privacy & Security → Speech Recognition, then start the call again.",
    );
  }
  if (probe.status !== "authorized") {
    throw new VoiceConnectError(
      "stt_permission_undetermined",
      "Speech recognition permission wasn't granted. Start the call again to re-prompt.",
    );
  }
  if (!probe.onDevice) {
    throw new VoiceConnectError(
      "stt_on_device_unsupported",
      `This Mac can't transcribe ${probe.locale || "the current language"} on-device — add the language under System Settings → Keyboard → Dictation, or pick a cloud voice provider in Familiar Studio → Brain.`,
    );
  }

  if (typeof MediaRecorder === "undefined") {
    throw new VoiceConnectError(
      "stt_unavailable",
      "This WebView cannot record microphone audio (no MediaRecorder).",
    );
  }
  const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) {
    throw new VoiceConnectError(
      "stt_unavailable",
      "This WebView can't record audio in a format the on-device recognizer reads.",
    );
  }

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new VoiceConnectError(
      "stt_unavailable",
      "This WebView has no Web Audio support for voice detection.",
    );
  }
  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(mic);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const timeData = new Uint8Array(analyser.fftSize);
  const readRms = () => {
    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / timeData.length);
  };

  const recorderStream = new MediaStream(mic.getAudioTracks());
  const vad = createVadGate();
  let closed = false;
  let listening = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let recorder: MediaRecorder | null = null;
  let recorderStartedAt = 0;
  let chunks: Blob[] = [];
  let sendOnStop = false;

  const transcribe = async (blob: Blob) => {
    try {
      const audioBase64 = await blobToBase64(blob);
      if (!audioBase64) return;
      const text = (
        await invoke<string>("speech_stt_transcribe", {
          audioBase64,
          mimeType: blob.type || mime,
          locale,
        })
      ).trim();
      if (closed || !text) return;
      callbacks.onFinal(text);
    } catch (e) {
      if (closed) return;
      callbacks.onError(parseNativeSttError(e instanceof Error ? e.message : String(e)));
    }
  };

  const startRecorder = () => {
    if (closed || !listening || recorder) return;
    chunks = [];
    sendOnStop = false;
    let next: MediaRecorder;
    try {
      next = new MediaRecorder(recorderStream, { mimeType: mime });
    } catch (e) {
      callbacks.onError(parseNativeSttError(e instanceof Error ? e.message : String(e)));
      return;
    }
    recorder = next;
    recorderStartedAt = Date.now();
    next.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = () => {
      const parts = chunks;
      const shouldSend = sendOnStop;
      chunks = [];
      sendOnStop = false;
      if (recorder === next) recorder = null;
      // Open the next recording window first so no speech gap follows.
      startRecorder();
      if (shouldSend && parts.length > 0 && !closed) {
        void transcribe(new Blob(parts, { type: next.mimeType || mime }));
      }
    };
    try {
      next.start();
    } catch (e) {
      if (recorder === next) recorder = null;
      callbacks.onError(parseNativeSttError(e instanceof Error ? e.message : String(e)));
    }
  };

  const stopRecorder = (send: boolean) => {
    const current = recorder;
    if (!current) return;
    sendOnStop = send;
    try {
      current.stop();
    } catch {
      recorder = null;
    }
  };

  const tick = () => {
    if (closed || !listening) return;
    const now = Date.now();
    const event = vad.push(readRms(), now);
    if (event === "end") stopRecorder(true);
    else if (event === "end-discard") stopRecorder(false);
    else if (event === "idle" && recorder && now - recorderStartedAt >= IDLE_RESTART_MS) {
      // Nothing but silence in this window — recycle it instead of growing it.
      stopRecorder(false);
    }
  };

  return {
    start() {
      if (closed || listening) return;
      listening = true;
      vad.reset();
      void audioContext.resume().catch(() => {});
      startRecorder();
      if (!interval) interval = setInterval(tick, VAD_POLL_MS);
    },
    stop() {
      if (!listening) return;
      listening = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      vad.reset();
      // Mid-utterance audio is discarded — the mouth is about to speak and
      // the tail would transcribe the synthesizer.
      stopRecorder(false);
    },
    close() {
      closed = true;
      listening = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      stopRecorder(false);
      recorder = null;
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      void audioContext.close().catch(() => {});
    },
  };
}
