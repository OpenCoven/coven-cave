"use client";

import { useEffect, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import type { ElevenLabsVoiceSettings } from "@/lib/voice/elevenlabs-shared";

export type PodcastPreviewRequest = {
  provider: "local" | "elevenlabs";
  voice: string;
  model?: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  seed?: number;
};

type PreviewState = {
  speaker: string;
  status: "idle" | "loading" | "playing" | "error";
  error?: string;
};
const IDLE: PreviewState = { speaker: "", status: "idle" };

/** One owner for both auditions: changing speakers also cancels pending audio. */
export function createPodcastPreviewController(
  onState: (state: PreviewState) => void,
  dependencies = {
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    audio: () => new Audio(),
    createUrl: (blob: Blob) => URL.createObjectURL(blob),
    revokeUrl: (url: string) => URL.revokeObjectURL(url),
  },
) {
  let epoch = 0;
  let pending: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  const release = () => {
    pending?.abort();
    pending = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }
    if (url) dependencies.revokeUrl(url);
    url = null;
  };
  const stop = (notify = true) => {
    epoch += 1;
    release();
    if (notify) onState(IDLE);
  };
  return {
    stop,
    async play(speaker: string, request: PodcastPreviewRequest) {
      stop(false);
      const current = epoch;
      const controller = new AbortController();
      pending = controller;
      onState({ speaker, status: "loading" });
      try {
        // Use the patched fetch path so the desktop sidecar auth is attached.
        // No source text is accepted here; the server owns the public sample.
        const response = await dependencies.fetch("/api/research/generations/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (current !== epoch || controller.signal.aborted) return;
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) {
          const body = await response.json().catch(() => null);
          throw new Error(typeof body?.error === "string" ? body.error : "Couldn’t load voice preview. Try again.");
        }
        const blob = await response.blob();
        if (current !== epoch || controller.signal.aborted) return;
        if (!blob.size) throw new Error("The voice preview was empty. Try again.");
        url = dependencies.createUrl(blob);
        audio = dependencies.audio();
        audio.src = url;
        audio.onended = () => {
          if (current === epoch) stop();
        };
        audio.onerror = () => {
          if (current !== epoch) return;
          stop(false);
          onState({ speaker, status: "error", error: "Couldn’t play voice preview. Try again." });
        };
        await audio.play();
        if (current !== epoch || controller.signal.aborted) return;
        onState({ speaker, status: "playing" });
      } catch (error) {
        if (current !== epoch || controller.signal.aborted) return;
        stop(false);
        onState({
          speaker,
          status: "error",
          error: error instanceof Error ? error.message : "Couldn’t play voice preview. Try again.",
        });
      }
    },
  };
}

export function PodcastVoicePreviews({
  request,
  guestVoice,
  narrator,
  disabled,
}: {
  request: PodcastPreviewRequest;
  guestVoice: string | null;
  narrator: boolean;
  disabled: boolean;
}) {
  const [state, setState] = useState<PreviewState>(IDLE);
  const { announce } = useAnnouncer();
  const controller = useRef<ReturnType<typeof createPodcastPreviewController> | null>(null);
  // The parent keys this component by every audible setting. Unmounting on a
  // selection change prevents old responses/play promises from taking over.
  useEffect(() => {
    controller.current = createPodcastPreviewController(setState);
    return () => {
      controller.current?.stop(false);
      controller.current = null;
    };
  }, []);
  const hostLabel = narrator ? "narrator" : "host";
  return (
    <div className="research-podcast-preview">
      <div className="research-podcast-preview__buttons">
        {[{ speaker: hostLabel, voice: request.voice }, ...(guestVoice !== null ? [{ speaker: "guest", voice: guestVoice || request.voice }] : [])].map(({ speaker, voice }) => {
          const active = state.speaker === speaker && (state.status === "loading" || state.status === "playing");
          return (
            <button
              key={speaker}
              type="button"
              className="research-studio-act research-studio-act--tiny focus-ring"
              disabled={disabled}
              aria-describedby="research-podcast-preview-help"
              onClick={() => {
                if (active) {
                  controller.current?.stop();
                  announce(`Stopped ${speaker} preview`);
                } else {
                  announce(`Loading ${speaker} preview`);
                  void controller.current?.play(speaker, { ...request, voice });
                }
              }}
            >
              {active ? `Stop ${speaker} preview` : state.speaker === speaker && state.status === "error" ? `Retry ${speaker} preview` : `Preview ${speaker} voice`}
            </button>
          );
        })}
      </div>
      <span id="research-podcast-preview-help" className="research-studio-config__hint">
        AI-generated sample using your selected voice, model and delivery. Only fixed public demo text is sent.
        {request.provider === "elevenlabs" ? " Each preview uses your ElevenLabs key and may incur usage charges." : " Local previews stay on this machine."}
      </span>
      <span role="status" className="research-studio-config__hint">
        {state.status === "loading" ? `Loading ${state.speaker} preview…` : state.status === "playing" ? `Playing ${state.speaker} preview` : ""}
      </span>
      {state.status === "error" ? <p role="alert" className="research-studio-config__error">{state.error} Use Retry to try again.</p> : null}
    </div>
  );
}
