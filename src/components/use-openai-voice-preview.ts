"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAnnouncer } from "@/components/ui/live-region";

export type OpenAiVoicePreviewState = "idle" | "loading" | "playing" | "error";

type PreviewOwner = {
  generation: number;
  controller: AbortController;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
};

const PREVIEW_FAILURE_COPY = "Couldn’t preview this OpenAI voice.";
const PREVIEW_UNSUPPORTED_COPY = "This realtime-only voice doesn’t have a spoken preview yet. It still works in live calls.";

function isPreviewUnsupported(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null &&
    "error" in payload && payload.error === "preview_unsupported";
}

export function useOpenAiVoicePreview(voiceId: string) {
  const { announce } = useAnnouncer();
  const [state, setState] = useState<OpenAiVoicePreviewState>("idle");
  const [error, setError] = useState<string | null>(null);
  const currentOwner = useRef<PreviewOwner | null>(null);
  const generation = useRef(0);

  const ownsCurrentPreview = useCallback((owner: PreviewOwner) => (
    currentOwner.current === owner &&
    generation.current === owner.generation &&
    !owner.controller.signal.aborted
  ), []);

  const cleanupOwner = useCallback((owner: PreviewOwner) => {
    owner.controller.abort();
    const audio = owner.audio;
    owner.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
    }
    const objectUrl = owner.objectUrl;
    owner.objectUrl = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    const owner = currentOwner.current;
    currentOwner.current = null;
    if (owner) cleanupOwner(owner);
    setError(null);
    setState("idle");
  }, [cleanupOwner]);

  const failOwner = useCallback((owner: PreviewOwner, message = PREVIEW_FAILURE_COPY) => {
    if (!ownsCurrentPreview(owner)) return;
    currentOwner.current = null;
    cleanupOwner(owner);
    setState("error");
    setError(message);
    announce(message, "assertive");
  }, [announce, cleanupOwner, ownsCurrentPreview]);

  const finishOwner = useCallback((owner: PreviewOwner, audio: HTMLAudioElement) => {
    if (!ownsCurrentPreview(owner) || owner.audio !== audio) return;
    currentOwner.current = null;
    cleanupOwner(owner);
    setError(null);
    setState("idle");
  }, [cleanupOwner, ownsCurrentPreview]);

  const start = useCallback(async () => {
    stop();
    const owner: PreviewOwner = {
      generation: ++generation.current,
      controller: new AbortController(),
      audio: null,
      objectUrl: null,
    };
    currentOwner.current = owner;
    setError(null);
    setState("loading");

    try {
      const response = await fetch(`/api/voice/preview?voice=${encodeURIComponent(voiceId)}`, {
        cache: "no-store",
        signal: owner.controller.signal,
      });
      if (!ownsCurrentPreview(owner)) return;

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (!ownsCurrentPreview(owner)) return;
        failOwner(
          owner,
          isPreviewUnsupported(payload) ? PREVIEW_UNSUPPORTED_COPY : PREVIEW_FAILURE_COPY,
        );
        return;
      }

      if (!(response.headers.get("content-type") ?? "").startsWith("audio/")) {
        failOwner(owner);
        return;
      }

      const blob = await response.blob();
      if (!ownsCurrentPreview(owner)) return;

      const objectUrl = URL.createObjectURL(blob);
      if (!ownsCurrentPreview(owner)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      owner.objectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      if (!ownsCurrentPreview(owner)) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        URL.revokeObjectURL(objectUrl);
        owner.objectUrl = null;
        return;
      }
      owner.audio = audio;
      audio.onended = () => finishOwner(owner, audio);
      audio.onerror = () => failOwner(owner);

      await audio.play();
      if (!ownsCurrentPreview(owner) || owner.audio !== audio) return;
      setState("playing");
    } catch {
      if (!ownsCurrentPreview(owner)) return;
      failOwner(owner);
    }
  }, [failOwner, finishOwner, ownsCurrentPreview, stop, voiceId]);

  const toggle = useCallback(() => {
    if (currentOwner.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => {
    stop();
  }, [stop, voiceId]);

  useEffect(() => () => {
    generation.current += 1;
    const owner = currentOwner.current;
    currentOwner.current = null;
    if (owner) cleanupOwner(owner);
  }, [cleanupOwner]);

  return { state, error, start, stop, toggle } as const;
}
