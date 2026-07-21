"use client";

/**
 * Prompt tab — mission intake: the composer plus the saved-links shelf.
 * Phase B1 rebuilds this into the design's "New research" screen (mode cards,
 * ✦ Improve, suggested angles, quick-save attach); until then the existing
 * composer and shelf carry the full intake behavior. `initialMode` arrives
 * from onNavigate (e.g. the Desk `/brief` command) — B1 wires it into the
 * composer's mode picker.
 */

import type { ResearchMissionMode } from "@/lib/research-missions";
import { ResearchLinkShelf } from "./research-link-shelf";
import { ResearchMissionComposer } from "./research-mission-composer";
import type { ResearchTabProps } from "./researcher-surface";

export type ResearchTabPromptProps = ResearchTabProps & {
  /** Composer mode preselected by cross-tab navigation. */
  initialMode?: ResearchMissionMode;
};

export function ResearchTabPrompt({ research, context, onNavigate, initialMode }: ResearchTabPromptProps) {
  return (
    <div className="research-prompt" data-initial-mode={initialMode ?? "auto"}>
      <section className="research-desk__intake" aria-label="Start research">
        <ResearchMissionComposer
          familiarId={context.activeFamiliar.id}
          daemonRunning={context.runtimeState.daemonRunning}
          onStart={async (input) => {
            const result = await research.start(input);
            // A freshly started mission lives on the Desk — follow it there.
            if (result.ok) onNavigate("desk", { missionId: result.mission.id });
            return result;
          }}
        />
      </section>
      <ResearchLinkShelf onOpenUrl={context.openUrl} />
    </div>
  );
}
