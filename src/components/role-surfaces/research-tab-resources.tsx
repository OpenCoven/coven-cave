"use client";

/**
 * Resources tab — saved links grouped by category, cross-referenced against
 * mission sources. Phase B5 builds the design's grouped resource browser;
 * this stub reports real mission-source counts only.
 */

import type { ResearchTabProps } from "./researcher-surface";

export function ResearchTabResources({ research }: ResearchTabProps) {
  const citedCount = research.missions.reduce((total, mission) => total + mission.sources.length, 0);

  return (
    <section className="research-tab-placeholder" aria-label="Research resources">
      <h2>Resources</h2>
      <p>
        {citedCount === 0
          ? "No sources cited yet — missions collect their evidence here as they run."
          : `${citedCount} source${citedCount === 1 ? "" : "s"} cited across your missions.`}
      </p>
    </section>
  );
}
