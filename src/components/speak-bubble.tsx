"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  resolveSpeechPlan,
  speechRequestFor,
  speechTextFor,
  type FamiliarVoice,
} from "@/lib/voice/speak-message";

/**
 * "Read this reply aloud" for the assistant bubble's hover action row.
 *
 * Speaks in the RESPONDING familiar's voice: voiceProvider/voiceName/voiceModel
 * are per-familiar config, so a reply should sound like whoever wrote it. The
 * familiar id rides in `feedbackContext`, which every MessageBubble call site
 * already threads, so this needs no new prop plumbing.
 */

// Same shape as familiar-inline-card's cache and the same failure rule: a
// FAILED load must not be cached for the app's lifetime, or one transient
// error silently mutes every message until a reload.
let voicesCache: Promise<Record<string, FamiliarVoice> | null> | null = null;
function loadFamiliarVoices(): Promise<Record<string, FamiliarVoice> | null> {
  if (!voicesCache) {
    voicesCache = fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok || !Array.isArray(j.familiars)) throw new Error("familiars load failed");
        const map: Record<string, FamiliarVoice> = {};
        for (const f of j.familiars) {
          map[f.id] = { provider: f.voiceProvider, name: f.voiceName, model: f.voiceModel };
        }
        return map;
      })
      .catch(() => {
        voicesCache = null;
        return null;
      });
  }
  return voicesCache;
}

/**
 * Only one message speaks at a time. Starting playback anywhere calls the
 * previous message's stopper first, so clicking a second speaker doesn't leave
 * two replies talking over each other.
 */
let activeStop: (() => void) | null = null;

type SpeakState = "idle" | "loading" | "playing";

export function SpeakBubble({ text, familiarId }: { text: string; familiarId?: string }) {
  const [state, setState] = useState<SpeakState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on every stop so an in-flight synthesis that lands late can tell it
  // has been superseded and must not start playing.
  const genRef = useRef(0);

  const teardown = () => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  const stop = () => {
    teardown();
    if (activeStop === stop) activeStop = null;
    setState("idle");
  };

  // Stop on unmount — a bubble scrolled out of a virtualized list should not
  // keep talking.
  useEffect(() => () => { teardown(); if (activeStop === stop) activeStop = null; }, []);

  const speak = async () => {
    activeStop?.();
    activeStop = stop;
    const gen = ++genRef.current;
    setState("loading");

    const spoken = speechTextFor(text);
    if (!spoken) { stop(); return; }

    const voices = familiarId ? await loadFamiliarVoices() : null;
    if (gen !== genRef.current) return;
    const plan = resolveSpeechPlan((familiarId && voices?.[familiarId]) || {});
    const request = speechRequestFor(plan, spoken);

    // No arbitrary-text route for this provider — the platform synthesizer
    // speaks it locally instead.
    if (!request) {
      if (typeof window === "undefined" || !window.speechSynthesis) { stop(); return; }
      const utterance = new SpeechSynthesisUtterance(spoken);
      if (plan.engine === "system" && plan.voiceName) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.name.toLowerCase() === plan.voiceName!.toLowerCase());
        if (match) utterance.voice = match;
      }
      utterance.onend = () => { if (gen === genRef.current) stop(); };
      utterance.onerror = () => { if (gen === genRef.current) stop(); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setState("playing");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // fetch (not a bare <audio src>) because the request carries the sidecar
      // auth token.
      const res = await fetch(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (gen !== genRef.current) return;
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("audio/")) {
        stop();
        return;
      }
      const blob = await res.blob();
      if (gen !== genRef.current) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { if (gen === genRef.current) stop(); };
      audio.onerror = () => { if (gen === genRef.current) stop(); };
      await audio.play();
      if (gen !== genRef.current) return;
      setState("playing");
    } catch {
      // Aborts land here too; a superseded generation must not clear the new one.
      if (gen === genRef.current) stop();
    }
  };

  const busy = state !== "idle";
  return (
    <button
      type="button"
      aria-label={busy ? "Stop reading response" : "Read response aloud"}
      title={busy ? "Stop" : "Read aloud"}
      aria-pressed={busy}
      onClick={() => (busy ? stop() : void speak())}
      className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
    >
      {/* Names come from the curated ICON_NAMES union — `ph:speaker-high-fill`
          is the only speaker glyph carried in the subset, so the idle state
          uses the fill variant rather than growing the catalogue. */}
      <Icon
        name={
          state === "playing"
            ? "ph:stop-fill"
            : state === "loading"
              ? "ph:circle-notch-bold"
              : "ph:speaker-high-fill"
        }
        width={13}
        aria-hidden
      />
    </button>
  );
}
