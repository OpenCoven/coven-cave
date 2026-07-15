"use client";

/**
 * Research Desk — a mission-first control plane over real familiar sessions.
 *
 * The desk owns intent, reviewable bounds, progress, evidence, and artifacts.
 * Flow remains the executor, Knowledge remains the durable artifact vault, and
 * the familiar's real session remains the escape hatch for direct steering.
 */

import { Button } from "@/components/ui/button";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { ResearchMissionComposer } from "./research-mission-composer";
import { ResearchMissionDetail } from "./research-mission-detail";
import { ResearchMissionList } from "./research-mission-list";
import { useResearchMissions } from "./use-research-missions";

export function ResearcherSurface({ context }: { context: RoleSurfaceContext }) {
  const research = useResearchMissions(context.activeFamiliar.id);

  return (
    <div className="research-desk">
      <section className="research-desk__intake" aria-label="Start research">
        <div className="research-desk__intake-copy">
          <span>Research familiar</span>
          <strong>From intent to evidence to durable knowledge.</strong>
        </div>
        <ResearchMissionComposer
          familiarId={context.activeFamiliar.id}
          daemonRunning={context.runtimeState.daemonRunning}
          onStart={research.start}
        />
      </section>

      <div className="research-desk__workspace">
        <ResearchMissionList
          missions={research.missions}
          selectedId={research.selectedId}
          loading={research.loading}
          onSelect={research.select}
        />
        <main className="research-desk__main">
          {research.error ? (
            <div className="research-desk__error" role="alert">
              <span>{research.error}</span>
              <Button size="xs" variant="ghost" onClick={() => void research.load()}>
                Try again
              </Button>
            </div>
          ) : null}
          <ResearchMissionDetail
            mission={research.selected}
            onOpenSession={(sessionId) => {
              context.openSession(sessionId, context.activeFamiliar.id);
            }}
            onOpenUrl={context.openUrl}
            onAction={(input) => research.selected
              ? research.act(research.selected.id, input)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onSchedule={(rrule) => research.selected
              ? research.schedule(research.selected.id, rrule)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onAutomationAction={(automationId, action) => research.selected
              ? research.controlAutomation(research.selected.id, automationId, action)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
          />
        </main>
      </div>
    </div>
  );
}
