// Grouping a podcast script for the screenplay transcript
// (Coven Podcast.dc.html — "Transcript · screenplay").
//
// Pure + JSX-free so it's unit-testable without a DOM, matching lib/file-ref.

import type {
  ResearchGenerationScriptSegment,
  ResearchPodcastSpeaker,
} from "@/lib/research-generations";

/** Consecutive segments sharing a speaker, so attribution prints once. */
export type SpeakerRun = {
  speaker: ResearchPodcastSpeaker | null;
  segments: ResearchGenerationScriptSegment[];
};

/**
 * Group the script into speaker runs, preserving order. A dialogue reads by
 * attribution — you follow one voice down the page — so repeating "Host" in
 * front of every consecutive host line is noise, not structure.
 */
export function groupBySpeaker(
  script: readonly ResearchGenerationScriptSegment[],
): SpeakerRun[] {
  const runs: SpeakerRun[] = [];
  for (const segment of script) {
    const speaker = segment.speaker ?? null;
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker) last.segments.push(segment);
    else runs.push({ speaker, segments: [segment] });
  }
  return runs;
}

/** The distinct speakers in the script, in first-appearance order. Empty for a
 *  single-narrator script, which has no cast to name. */
export function castOf(
  script: readonly ResearchGenerationScriptSegment[],
): ResearchPodcastSpeaker[] {
  const seen: ResearchPodcastSpeaker[] = [];
  for (const segment of script) {
    if (segment.speaker && !seen.includes(segment.speaker)) seen.push(segment.speaker);
  }
  return seen;
}

export const SPEAKER_LABEL: Record<ResearchPodcastSpeaker, string> = {
  host: "Host",
  guest: "Guest",
};
