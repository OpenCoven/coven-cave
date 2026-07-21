"use client";

/**
 * Desk tab — the mission workspace: runs rail, mission detail (which mounts
 * the evidence ledger), and the load-error banner. Phase B2 reshapes this into
 * the design's status-first desk; behavior here matches the pre-tab surface
 * exactly so the desk stays fully functional in the meantime.
 */

import { Button } from "@/components/ui/button";
import { ResearchMissionDetail } from "./research-mission-detail";
import { ResearchMissionList } from "./research-mission-list";
import type { ResearchTabProps } from "./researcher-surface";

export function ResearchTabDesk({ research, context }: ResearchTabProps) {
  return (
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
  );
}
