"use client";

import { memo } from "react";
import type { ResearchGenerationScriptSegment } from "@/lib/research-generations";
import { SPEAKER_LABEL, castOf, groupBySpeaker } from "@/lib/podcast-script";

/**
 * A podcast script rendered as a screenplay rather than a list of paragraphs
 * (Coven Podcast.dc.html — "Transcript · screenplay").
 *
 * The drafter produces speaker-attributed segments, and until now the app threw
 * that structure away: the review sheet printed a flat `<ol>` with a bold
 * "Host"/"Guest" run in front of each line, so a two-voice dialogue read as one
 * undifferentiated column of text and the cast was invisible.
 *
 * A screenplay reads by attribution — you follow one voice down the page. So
 * speakers get a gutter, consecutive lines from the same voice are grouped
 * under a single attribution rather than repeating it, and the cast is stated
 * up front with the voice each speaker was rendered in.
 *
 * Nothing here is generated: every line is a `text` the drafter extracted, and
 * a segment with no `speaker` is a single-narrator script, which renders
 * without a gutter instead of being assigned a voice it never had.
 */

export type PodcastTranscriptProps = {
  script: readonly ResearchGenerationScriptSegment[];
  /** Per-speaker voices when the render config assigned them. */
  voices?: { host: string; guest: string };
  /** The single voice a narrator script was rendered in. */
  voice?: string;
  /** `compact` tightens the leading for scanning a long episode. */
  density?: "comfortable" | "compact";
};

export const PodcastTranscript = memo(function PodcastTranscript({
  script,
  voices,
  voice,
  density = "comfortable",
}: PodcastTranscriptProps) {
  if (script.length === 0) {
    return (
      <p className="podcast-transcript__empty">
        This episode has no script segments yet.
      </p>
    );
  }
  const runs = groupBySpeaker(script);
  const cast = castOf(script);
  const dialogue = cast.length > 0;

  return (
    <div className={`podcast-transcript podcast-transcript--${density}`}>
      <div className="podcast-transcript__head">
        <span className="podcast-transcript__eyebrow">
          {dialogue ? "The cast" : "Narration"}
        </span>
        <ul className="podcast-transcript__cast">
          {dialogue ? (
            cast.map((speaker) => (
              <li key={speaker} className={`podcast-transcript__voice podcast-transcript__voice--${speaker}`}>
                <b>{SPEAKER_LABEL[speaker]}</b>
                {/* The voice each speaker was actually rendered in — the one
                    fact a transcript can state that the audio cannot. */}
                {voices?.[speaker] ? <span>{voices[speaker]}</span> : null}
              </li>
            ))
          ) : (
            <li className="podcast-transcript__voice">
              <b>Single narrator</b>
              {voice ? <span>{voice}</span> : null}
            </li>
          )}
        </ul>
        <span className="podcast-transcript__count">
          {script.length} segment{script.length === 1 ? "" : "s"}
        </span>
      </div>

      <ol className="podcast-transcript__script">
        {runs.map((run, runIndex) => (
          <li
            key={run.segments[0].id}
            className={`podcast-transcript__run${run.speaker ? ` podcast-transcript__run--${run.speaker}` : ""}`}
          >
            {run.speaker ? (
              <span className="podcast-transcript__attribution">
                {SPEAKER_LABEL[run.speaker]}
              </span>
            ) : null}
            <div className="podcast-transcript__lines">
              {/* The opening line is the cold open — the one segment a listener
                  hears before they know what the episode is. */}
              {runIndex === 0 ? (
                <span className="podcast-transcript__cue">Cold open</span>
              ) : null}
              {run.segments.map((segment) => (
                <p key={segment.id} className="podcast-transcript__line">
                  {segment.text}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});
