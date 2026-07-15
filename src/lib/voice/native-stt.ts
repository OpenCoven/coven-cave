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

/** Ask the native side whether it has a speech engine (macOS only today). */
export async function nativeSttAvailable(bridge: NativeSttBridge): Promise<boolean> {
  try {
    const availability = await bridge.invoke<{ supported?: boolean }>("speech_stt_available");
    return availability?.supported === true;
  } catch {
    return false;
  }
}

export type NativeSttEarsOptions = {
  /** BCP-47 tag for the recognizer locale; empty for the system default. */
  lang?: string;
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
          .invoke("speech_stt_start", { session, lang: opts.lang ?? null })
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

/**
 * The ears the current window should use: the native macOS engine inside the
 * Tauri shell, undefined elsewhere (the loop falls back to WebSpeech).
 */
export async function resolvePreferredEars(): Promise<SpeechEarsFactory | undefined> {
  const bridge = await loadNativeSttBridge();
  if (!bridge) return undefined;
  if (!(await nativeSttAvailable(bridge))) return undefined;
  return createNativeSttEars(bridge, {
    lang: typeof navigator !== "undefined" ? navigator.language || undefined : undefined,
  });
}
