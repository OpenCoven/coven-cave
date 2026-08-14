/**
 * Studio provider strip.
 *
 * The handoff puts a row of provider chips beside the Studio heading so the
 * reason a media card is disabled is visible before you click it. The frame
 * lists five invented providers with invented states; this reads the four the
 * readiness endpoint actually reports, and says "checking…" while the snapshot
 * is still in flight rather than guessing "ready".
 *
 * Every blocked chip carries the endpoint's own hint as its detail, so the
 * remediation text on the chip and on the card it blocks are the same string.
 */

import type { ResearchGenerationReadiness } from "@/lib/research-generations";

export type ProviderChipState = "ready" | "blocked" | "unknown";

export type ProviderChip = {
  id: string;
  name: string;
  state: ProviderChipState;
  /** One line: what it is, or why it cannot be used yet. */
  detail: string;
};

const UNKNOWN = "Checking availability…";

/**
 * Build the chip row. A null readiness (first load, or a refresh that failed
 * and left no verified snapshot) yields every chip as "unknown" — the strip
 * still renders, because "we don't know yet" is information and a vanishing
 * row is not.
 */
export function researchProviderChips(
  readiness: ResearchGenerationReadiness | null,
): ProviderChip[] {
  if (!readiness) {
    return [
      { id: "local", name: "Local voices", state: "unknown", detail: UNKNOWN },
      { id: "elevenlabs", name: "ElevenLabs", state: "unknown", detail: UNKNOWN },
      { id: "ffmpeg", name: "ffmpeg", state: "unknown", detail: UNKNOWN },
      { id: "podcast", name: "Podcast pipeline", state: "unknown", detail: UNKNOWN },
    ];
  }

  const { local, elevenlabs } = readiness.providers;
  const voiceCount = local.voices.length;
  return [
    {
      id: "local",
      name: "Local voices",
      state: local.ready ? "ready" : "blocked",
      detail: local.ready
        ? `${voiceCount} voice${voiceCount === 1 ? "" : "s"} installed on this machine`
        : local.hint ?? "No local voices are installed.",
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs",
      state: elevenlabs.ready ? "ready" : "blocked",
      detail: elevenlabs.ready
        ? "Authenticated — hosted voices available"
        : elevenlabs.hint ?? "Needs authentication before its voices can be listed.",
    },
    {
      id: "ffmpeg",
      name: "ffmpeg",
      state: readiness.ffmpeg.ready ? "ready" : "blocked",
      detail: readiness.ffmpeg.ready
        ? "ffmpeg and ffprobe both found"
        : readiness.ffmpeg.hint ?? "ffmpeg or ffprobe is missing — video and audio cannot render.",
    },
    {
      id: "podcast",
      name: "Podcast pipeline",
      state: readiness.podcast.ready ? "ready" : "blocked",
      detail: readiness.podcast.ready
        ? "Ready to draft and render"
        : readiness.podcast.hint ?? "The podcast pipeline is not ready.",
    },
  ];
}

/** "3 of 4 ready" — a summary for the strip's screen-reader label. */
export function describeProviderChips(chips: readonly ProviderChip[]): string {
  const ready = chips.filter((chip) => chip.state === "ready").length;
  const unknown = chips.filter((chip) => chip.state === "unknown").length;
  if (unknown === chips.length) return "Media provider readiness is still loading";
  return `Media providers — ${ready} of ${chips.length} ready`;
}
