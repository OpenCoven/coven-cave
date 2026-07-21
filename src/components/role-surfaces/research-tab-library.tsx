"use client";

/**
 * Library tab — artifacts aggregated across missions. Phase B3 builds the
 * design's card/row library (filters, live ticker, watch); this stub reports
 * real counts only so nothing on screen is fabricated.
 */

import type { ResearchTabProps } from "./researcher-surface";

export function ResearchTabLibrary({ research }: ResearchTabProps) {
  const missionsWithArtifacts = research.missions.filter((mission) => mission.artifacts.length > 0);
  const artifactCount = missionsWithArtifacts.reduce((total, mission) => total + mission.artifacts.length, 0);

  return (
    <section className="research-tab-placeholder" aria-label="Research library">
      <h2>Library</h2>
      <p>
        {artifactCount === 0
          ? "No artifacts yet — missions publish their findings here as they run."
          : `${artifactCount} artifact${artifactCount === 1 ? "" : "s"} across ${missionsWithArtifacts.length} mission${missionsWithArtifacts.length === 1 ? "" : "s"}. Open a mission on the Desk to read them.`}
      </p>
    </section>
  );
}
