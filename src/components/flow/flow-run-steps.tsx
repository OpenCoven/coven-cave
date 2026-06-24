"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { catalogNode } from "@/lib/flow/flow-catalog";
import type { FlowDoc } from "@/lib/flow/flow-doc";
import type { FlowNodePhase, FlowRunProgress } from "@/lib/flow/flow-progress";
import type { FlowRunRecord } from "@/lib/flows";

const STATUS_LABEL: Record<FlowRunRecord["status"], string> = {
  preview: "Preview",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const PHASE_ICON: Record<FlowNodePhase, IconName> = {
  pending: "ph:circle-dashed",
  running: "ph:circle-notch-bold",
  succeeded: "ph:check-circle-fill",
  failed: "ph:x-circle-fill",
  skipped: "ph:minus-circle",
};

export type FlowRunStepsProps = {
  doc: FlowDoc;
  run: FlowRunRecord;
  progress: FlowRunProgress;
  /** True while the run's session is still being polled. */
  running: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
  onStop: () => void;
};

/**
 * Live step list docked beside the canvas. Walks the run's steps in execution
 * order, painting each with its live phase parsed from the agent transcript and
 * surfacing the active step's narration — so the run is legible on the page, not
 * only as coloured dots scattered across the graph. Click a step to focus its
 * node.
 */
export function FlowRunSteps({
  doc,
  run,
  progress,
  running,
  selectedNodeId,
  onSelectNode,
  onOpenSession,
  onStop,
}: FlowRunStepsProps) {
  const [collapsed, setCollapsed] = useState(false);

  const nameById = useMemo(
    () => new Map(doc.nodes.map((node) => [node.id, node.name])),
    [doc.nodes],
  );
  const detailById = useMemo(
    () => new Map(progress.steps.map((step) => [step.id, step.detail])),
    [progress.steps],
  );

  // Prefer the live-parsed phase; fall back to the run's persisted step status
  // (e.g. a finished run reopened, or before any markers land).
  const phaseFor = (id: string, persisted: FlowRunStepRecordStatus): FlowNodePhase =>
    (progress.markersFound ? progress.phases[id] : undefined) ?? persisted;

  const doneCount = run.steps.filter((step) => phaseFor(step.id, step.status) === "succeeded").length;

  return (
    <aside className={`flow-run-steps${collapsed ? " is-collapsed" : ""}`} aria-label="Flow run steps">
      <header className="flow-run-steps-head">
        <button
          type="button"
          className="flow-run-steps-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand steps" : "Collapse steps"}
        >
          <Icon name={collapsed ? "ph:caret-right" : "ph:caret-down"} width={13} />
        </button>
        <span className={`flow-run-steps-status flow-exec-status-${run.status}`}>
          {STATUS_LABEL[run.status]}
        </span>
        <span className="flow-run-steps-count">
          {doneCount}/{run.steps.length} steps
        </span>
        {running && (
          <button type="button" className="flow-run-steps-stop" onClick={onStop} title="Stop run">
            <Icon name="ph:stop-fill" width={12} /> Stop
          </button>
        )}
      </header>

      {!collapsed && (
        <ol className="flow-run-steps-list">
          {run.steps.map((step) => {
            const phase = phaseFor(step.id, step.status);
            const def = catalogNode(step.type);
            const name = nameById.get(step.id) ?? def?.label ?? step.type;
            const detail = detailById.get(step.id) ?? "";
            const isActive = phase === "running";
            const isSelected = step.id === selectedNodeId;
            return (
              <li
                key={step.id}
                className={`flow-run-step flow-run-step-${phase}${isSelected ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="flow-run-step-row"
                  onClick={() => onSelectNode(step.id)}
                  title={`Focus ${name}`}
                >
                  <span className={`flow-run-step-icon flow-run-step-icon-${phase}`} aria-hidden>
                    <Icon
                      name={PHASE_ICON[phase]}
                      width={15}
                      className={isActive ? "flow-run-step-spin" : undefined}
                    />
                  </span>
                  <span className="flow-run-step-body">
                    <span className="flow-run-step-name">{name}</span>
                    <span className="flow-run-step-type">{def?.label ?? step.type}</span>
                  </span>
                  <span className="flow-run-step-phase" aria-label={phase}>
                    {phase}
                  </span>
                </button>
                {isActive && detail && (
                  <p className="flow-run-step-detail">{detail.slice(0, 280)}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!collapsed && run.sessionId && (
        <footer className="flow-run-steps-foot">
          <button
            type="button"
            className="flow-run-steps-open"
            onClick={() => onOpenSession(run.sessionId as string)}
          >
            <Icon name="ph:chat-circle-dots" width={13} /> Open session
          </button>
        </footer>
      )}
    </aside>
  );
}

type FlowRunStepRecordStatus = FlowRunRecord["steps"][number]["status"];
