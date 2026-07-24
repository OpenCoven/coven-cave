// Native macOS speech-to-text ears for the local voice loop (cave-0ogg).
//
// WKWebView ships no SpeechRecognition, so in the packaged desktop app the
// ears half of the speech loop runs natively: src-tauri/src/speech.rs taps
// the mic with AVAudioEngine and streams SFSpeechRecognizer transcripts back
// as `speech-stt:event` events. This module is the JS half of that pair — a
// SpeechEars implementation over the Tauri command bridge.
//
// ENDPOINTING LIVES HERE, not in Rust: SFSpeechRecognizer streams partials
// until it is told the utterance is over (`speech_stt_finish` → endAudio →
// one final result). The user "finished a sentence" when the partial
// transcript stops changing for PARTIAL_STABILITY_MS — a testable timer
// policy — with MAX_UTTERANCE_MS as the runaway cap. Each utterance is one
// numbered native session; stale events from a torn-down session are
// dropped by id.

import type { SpeechEars, SpeechEarsFactory, SpeechEarsHandlers } from "./speech-loop.ts";
import type { VoiceEarsEngine } from "./types.ts";
import { VoiceConnectError } from "./types.ts";
import { createSidecarWhisperEars, localSidecarWhisperAvailable } from "./sidecar-whisper-ears.ts";

/** Event channel mirrored from src-tauri/src/speech.rs. */
export const STT_EVENT = "speech-stt:event";

/** A partial transcript unchanged for this long ends the utterance. */
export const PARTIAL_STABILITY_MS = 1_200;

/** Hard cap per utterance so a noisy room can't hold the brain hostage. */
export const MAX_UTTERANCE_MS = 30_000;

export type SttEventPayload = {
  session: number;
  kind: "partial" | "final" | "error" | "end";
  text?: string;
  code?: string;
  message?: string;
};

export type NativeSttBridge = {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
};

/** Load the Tauri bridge, or null outside the desktop shell. */
export async function loadNativeSttBridge(): Promise<NativeSttBridge | null> {
  if (typeof window === "undefined") return null;
  if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return null;
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return { invoke, listen };
}

/** Availability payload mirrored from src-tauri/src/speech.rs. */
export type SttAvailabilityPayload = {
  supported?: boolean;
  /** The resolved recognizer can transcribe fully on-device. */
  onDevice?: boolean;
  locale?: string | null;
  reason?: string | null;
};

/** Probe the native engine's availability + on-device support for a
 *  language; null when the probe itself fails. */
export async function nativeSttAvailability(
  bridge: NativeSttBridge,
  lang?: string,
): Promise<SttAvailabilityPayload | null> {
  try {
    return await bridge.invoke<SttAvailabilityPayload>("speech_stt_available", {
      lang: lang ?? null,
    });
  } catch {
    return null;
  }
}

/** Ask the native side whether it has a speech engine (macOS only today). */
export async function nativeSttAvailable(bridge: NativeSttBridge): Promise<boolean> {
  return (await nativeSttAvailability(bridge))?.supported === true;
}

export type NativeSttEarsOptions = {
  /** BCP-47 tag for the recognizer locale; empty for the system default. */
  lang?: string;
  /** Hard-require the on-device dictation model (the Local provider's
   *  "no cloud" contract) — the native side refuses to fall back to
   *  Apple's dictation service (cave-vpe1). */
  requireOnDevice?: boolean;
  stabilityMs?: number;
  maxUtteranceMs?: number;
  /** Injectable timers for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/**
 * SpeechEars over the native macOS engine. One factory per voice call; each
 * `listen()`→final cycle is one numbered native session, auto-restarted
 * while listening is wanted (mirrors WebSpeech's onend→restart contract).
 */
export function createNativeSttEars(
  bridge: NativeSttBridge,
  opts: NativeSttEarsOptions = {},
): SpeechEarsFactory {
  const stabilityMs = opts.stabilityMs ?? PARTIAL_STABILITY_MS;
  const maxUtteranceMs = opts.maxUtteranceMs ?? MAX_UTTERANCE_MS;
  const schedule = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const unschedule = opts.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as number));

  return (handlers: SpeechEarsHandlers): SpeechEars => {
    let wanted = false;
    let closed = false;
    let current = 0; // 0 = no live native session
    let counter = 0;
    let stabilityTimer: unknown = null;
    let capTimer: unknown = null;
    let unlisten: (() => void) | null = null;

    const clearTimers = () => {
      if (stabilityTimer !== null) { unschedule(stabilityTimer); stabilityTimer = null; }
      if (capTimer !== null) { unschedule(capTimer); capTimer = null; }
    };

    const finishUtterance = (session: number) => {
      clearTimers();
      if (session !== current) return;
      void bridge.invoke("speech_stt_finish", { session }).catch(() => { /* torn down */ });
    };

    const onEvent = (payload: SttEventPayload) => {
      if (closed || payload.session !== current) return;
      if (payload.kind === "partial") {
        const text = payload.text ?? "";
        // Every fresh partial resets the "sentence over" clock.
        if (stabilityTimer !== null) unschedule(stabilityTimer);
        const session = current;
        stabilityTimer = schedule(() => finishUtterance(session), stabilityMs);
        if (capTimer === null) {
          capTimer = schedule(() => finishUtterance(session), maxUtteranceMs);
        }
        if (text.trim()) handlers.onPartial(text);
        return;
      }
      if (payload.kind === "final") {
        clearTimers();
        current = 0;
        const text = (payload.text ?? "").trim();
        if (text) handlers.onFinal(text);
        // The native task is one-shot — keep listening for the next turn.
        if (wanted) start();
        return;
      }
      if (payload.kind === "error") {
        clearTimers();
        current = 0;
        // Engine failures end the listening state; the loop owns retry UX.
        wanted = false;
        handlers.onError(payload.code ?? "stt_failed", payload.message);
        return;
      }
      // "end" without a final (cancelled task, empty audio): restart if the
      // loop still wants ears open.
      if (payload.kind === "end" && current !== 0) {
        clearTimers();
        current = 0;
        if (wanted) start();
      }
    };

    const subscribed: Promise<void> = bridge
      .listen<SttEventPayload>(STT_EVENT, (e) => onEvent(e.payload))
      .then((stop) => {
        if (closed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        handlers.onError("stt_unavailable", "The native speech event channel could not be opened.");
      });

    const start = () => {
      if (closed || !wanted || current !== 0) return;
      const session = ++counter;
      current = session;
      void subscribed.then(() => {
        if (closed || !wanted || current !== session) return;
        bridge
          .invoke("speech_stt_start", {
            session,
            lang: opts.lang ?? null,
            requireOnDevice: opts.requireOnDevice ?? false,
          })
          .catch((err) => {
            if (closed || current !== session) return;
            current = 0;
            wanted = false;
            handlers.onError(
              "stt_unavailable",
              err instanceof Error ? err.message : String(err),
            );
          });
      });
    };

    const stopCurrent = () => {
      clearTimers();
      if (current === 0) return;
      const session = current;
      current = 0;
      void bridge.invoke("speech_stt_stop", { session }).catch(() => { /* already gone */ });
    };

    return {
      listen() {
        if (closed) return;
        wanted = true;
        start();
      },
      hush() {
        wanted = false;
        stopCurrent();
      },
      close() {
        closed = true;
        wanted = false;
        stopCurrent();
        unlisten?.();
        unlisten = null;
      },
    };
  };
}

/** Preferred ears plus which engine mode they run on (for honest call UI). */
export type PreferredEars = {
  factory: SpeechEarsFactory;
  engine: Extract<VoiceEarsEngine, "sidecar-whisper" | "native-on-device" | "native-dictation">;
};

/** The hybrid on-device policy (cave-vpe1) as a pure, pinnable decision:
 *  strict callers get on-device or an actionable VoiceConnectError; everyone
 *  else gets the honest engine label for whatever this Mac can do. */
export function selectNativeEarsEngine(
  availability: Pick<SttAvailabilityPayload, "onDevice" | "locale">,
  requireOnDevice: boolean,
): PreferredEars["engine"] {
  if (availability.onDevice) return "native-on-device";
  if (requireOnDevice) {
    throw new VoiceConnectError(
      "stt_on_device_unsupported",
      `This Mac can't transcribe ${availability.locale || "the current language"} on-device — download the dictation model under System Settings → Keyboard → Dictation, or pick a cloud voice provider in Familiar Studio → Brain.`,
    );
  }
  return "native-dictation";
}

/**
 * The ears the current window should use: the native macOS engine inside the
 * Tauri shell, undefined elsewhere (the loop falls back to WebSpeech).
 * `requireOnDevice` applies the Local provider's "no cloud" contract —
 * rejects with `stt_on_device_unsupported` instead of ever reaching Apple's
 * dictation service.
 */
export async function resolvePreferredEars(
  opts: { requireOnDevice?: boolean; allowSidecar?: boolean } = {},
): Promise<PreferredEars | undefined> {
  // A verified sidecar model is fully local on every supported platform, and
  // deliberately outranks the Apple-specific recognizer for consistent voice
  // behavior. Do not probe this during SSR: the browser's authenticated fetch
  // is what reaches a packaged sidecar.
  if (opts.allowSidecar !== false && typeof window !== "undefined" && await localSidecarWhisperAvailable()) {
    return { factory: createSidecarWhisperEars(), engine: "sidecar-whisper" };
  }
  const bridge = await loadNativeSttBridge();
  if (!bridge) {
    if (opts.requireOnDevice) {
      throw new VoiceConnectError(
        "stt_on_device_unavailable",
        "Download a local Whisper model in Settings to use Local voice on this device.",
      );
    }
    return undefined;
  }
  const lang = typeof navigator !== "undefined" ? navigator.language || undefined : undefined;
  const availability = await nativeSttAvailability(bridge, lang);
  if (availability?.supported !== true) return undefined;
  const engine = selectNativeEarsEngine(availability, opts.requireOnDevice ?? false);
  return {
    factory: createNativeSttEars(bridge, {
      lang,
      requireOnDevice: opts.requireOnDevice ?? false,
    }),
    engine,
  };
}
