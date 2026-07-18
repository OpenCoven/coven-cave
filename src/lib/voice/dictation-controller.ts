// Composer dictation over the swappable SpeechEars engines (voice new-chat,
// spec: docs/superpowers/specs/2026-07-18-voice-new-chat-design.md).
//
// Framework-free so behavior is unit-testable; use-dictation.ts is the thin
// React wrapper. Unlike the call loop (half-duplex policy), dictation is a
// simple push-to-talk toggle: the user owns start/stop, finals accumulate in
// the composer for review — never auto-sent.

import type { SpeechEarsFactory, SpeechEars } from "./speech-loop.ts";
import { createWebSpeechEars } from "./speech-loop.ts";
import { resolvePreferredEars } from "./native-stt.ts";

export type DictationHandlers = {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(code: string, hint?: string): void;
  onListeningChange(listening: boolean): void;
};

export type DictationController = {
  isListening(): boolean;
  start(): void;
  stop(): void;
  close(): void;
};

/** The ears this window can dictate with: native macOS STT in the Tauri
 *  shell, WebSpeech elsewhere, null when neither exists (callers hide the
 *  mic — a permanently disabled mic reads as broken). Dictation accepts
 *  Apple's dictation service (requireOnDevice false): it is the OS-level
 *  dictation UX users already expect. */
export async function resolveDictationEars(): Promise<SpeechEarsFactory | null> {
  const preferred = await resolvePreferredEars().catch(() => undefined);
  if (preferred) return preferred.factory;
  return createWebSpeechEars();
}

export async function createDictationController(
  handlers: DictationHandlers,
  resolveEarsFactory: () => Promise<SpeechEarsFactory | null> = resolveDictationEars,
): Promise<DictationController | null> {
  const factory = await resolveEarsFactory().catch(() => null);
  if (!factory) return null;

  let ears: SpeechEars | null = null;
  let listening = false;
  let closed = false;

  const setListening = (next: boolean) => {
    if (listening === next) return;
    listening = next;
    handlers.onListeningChange(next);
  };

  const controller: DictationController = {
    isListening: () => listening,
    start() {
      if (closed || listening) return;
      if (!ears) {
        ears = factory({
          // Partials are ephemeral caption text — only meaningful while
          // listening. Finals flow until close(): WebSpeech's stop() flushes
          // the tail utterance asynchronously AFTER hush(), and that text was
          // all spoken while listening (audio capture cuts at stop), so
          // dropping it would lose the user's last sentence.
          onPartial: (text) => { if (listening) handlers.onPartial(text); },
          onFinal: (text) => { if (!closed) handlers.onFinal(text); },
          onError: (code, hint) => {
            if (closed) return;
            handlers.onError(code, hint);
            controller.stop();
          },
        });
      }
      setListening(true);
      ears.listen();
    },
    stop() {
      if (!listening) return;
      setListening(false);
      ears?.hush();
    },
    close() {
      closed = true;
      listening = false;
      ears?.close();
      ears = null;
    },
  };
  return controller;
}
