"use client";

/**
 * Studio tab — turns mission artifacts into shareable formats (diagram, blog,
 * slides, infographic, thread) via /api/research/generations. Phase B4 builds
 * the generation grid + viewer; this stub reports real source counts only.
 */

import type { ResearchTabProps } from "./researcher-surface";

export function ResearchTabStudio({ research }: ResearchTabProps) {
  const sourceMissions = research.missions.filter((mission) => mission.artifacts.length > 0);

  return (
    <section className="research-tab-placeholder" aria-label="Research studio">
      <h2>Studio</h2>
      <p>
        {sourceMissions.length === 0
          ? "Nothing to generate from yet — a mission needs at least one artifact before the Studio can draft from it."
          : `${sourceMissions.length} mission${sourceMissions.length === 1 ? "" : "s"} with artifacts ready to draft from.`}
      </p>
    </section>
  );
}
