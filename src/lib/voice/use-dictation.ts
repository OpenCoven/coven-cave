"use client";

// React wrapper around the pure dictation controller — see
// dictation-controller.ts for behavior and tests. Composers use this to
// drive a push-to-talk mic that appends finalized utterances to the draft
// (fill & review — never auto-send).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDictationController,
  resolveDictationEars,
  type DictationController,
} from "./dictation-controller.ts";

export type Dictation = {
  /** False until an ears engine resolves; hide the mic while false. */
  available: boolean;
  listening: boolean;
  /** Live partial transcript while listening ("" between utterances). */
  partial: string;
  toggle(): void;
};

export function useDictation(
  onFinal: (text: string) => void,
  onError?: (code: string, hint?: string) => void,
): Dictation {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const controllerRef = useRef<DictationController | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const controller = await createDictationController(
        {
          onPartial: (text) => setPartial(text),
          onFinal: (text) => {
            setPartial("");
            onFinalRef.current(text);
          },
          onError: (code, hint) => {
            setPartial("");
            onErrorRef.current?.(code, hint);
          },
          onListeningChange: (next) => {
            setListening(next);
            if (!next) setPartial("");
          },
        },
        resolveDictationEars,
      );
      if (cancelled) {
        controller?.close();
        return;
      }
      controllerRef.current = controller;
      setAvailable(controller !== null);
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.close();
      controllerRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.isListening()) controller.stop();
    else controller.start();
  }, []);

  return { available, listening, partial, toggle };
}
