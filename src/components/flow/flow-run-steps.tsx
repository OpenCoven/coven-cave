"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { catalogNode } from "@/lib/flow/flow-catalog";
import type { FlowDoc } from "@/lib/flow/flow-doc";
import type { FlowNodePhase, FlowRunProgress } from "@/lib/flow/flow-progress";
import type { FlowRunRecord } from "@/lib/flows";
import { stripStepMarkers } from "@/lib/workflow-step-progress";

const STATUS_LABEL: Record<FlowRunRecord["status"], string> = {
  preview: "Preview",
  queued: "Queued",
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
 * order, painting each with its live phase parsed from the agent transcript.
 * Each step headlines its `@@step-note` summary and expands to reveal its own
 * cleaned log (the active step auto-opens) — so the run is legible per step, not
 * only as coloured dots scattered across the graph. Click a step's row to focus
 * its node; click the chevron to open its log. The "Session output" pane shows
 * the full transcript with bookkeeping markers scrubbed out.
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
  const [logsOpen, setLogsOpen] = useState(false);
  // Steps the user has manually expanded to read the full per-step log.
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set());
  const toggleStep = (id: string) =>
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Marker lines (`@@step-…`) are bookkeeping, not output — scrub them so the
  // session log reads as prose. Show the most recent window.
  const transcript = useMemo(() => stripStepMarkers(progress.transcript), [progress.transcript]);
  const nameById = useMemo(
    () => new Map(doc.nodes.map((node) => [node.id, node.name])),
    [doc.nodes],
  );
  const detailById = useMemo(
    () => new Map(progress.steps.map((step) => [step.id, step.detail])),
    [progress.steps],
  );
  const noteById = useMemo(
    () => new Map(progress.steps.map((step) => [step.id, step.note ?? ""])),
    [progress.steps],
  );

  // Prefer parsed/seeded progress; fall back to the stored run state for older
  // historical records that predate live progress snapshots.
  const phaseFor = (id: string, persisted: FlowRunStepRecordStatus): FlowNodePhase =>
    progress.phases[id] ?? persisted;

  const doneCount = run.steps.filter((step) => phaseFor(step.id, step.status) === "succeeded").length;
  const moving = run.steps.some((step) => phaseFor(step.id, step.status) !== "pending");
  const waitingForOutput = running && !progress.markersFound && !moving;

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

      {!collapsed && waitingForOutput && (
        <p className="flow-run-steps-stall" role="status">
          <Icon name="ph:warning-circle" width={14} />
          <span>
            {transcript
              ? "Session is running but hasn't reported any step progress yet — check the output below or open the session."
              : "Waiting for the session to start producing output…"}
          </span>
        </p>
      )}

      {!collapsed && (
        <ol className="flow-run-steps-list">
          {run.steps.map((step) => {
            const phase = phaseFor(step.id, step.status);
            const def = catalogNode(step.type);
            const name = nameById.get(step.id) ?? def?.label ?? step.type;
            const detail = detailById.get(step.id) ?? "";
            const note = noteById.get(step.id) ?? "";
            const isActive = phase === "running";
            const isSelected = step.id === selectedNodeId;
            // The active step auto-opens so live narration is visible; otherwise
            // the row's log stays collapsed until the user expands it.
            const isExpanded = expandedSteps.has(step.id) || (isActive && detail !== "");
            const canExpand = detail !== "";
            return (
              <li
                key={step.id}
                className={`flow-run-step flow-run-step-${phase}${isSelected ? " is-selected" : ""}`}
              >
                <div className="flow-run-step-row">
                  <button
                    type="button"
                    className="flow-run-step-main"
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
                      {/* A `@@step-note` summary headlines what the step produced;
                          fall back to the node type when there's no note yet. */}
                      <span className="flow-run-step-type">{note || def?.label || step.type}</span>
                    </span>
                    <span className="flow-run-step-phase" aria-label={phase}>
                      {phase}
                    </span>
                  </button>
                  {canExpand && (
                    <button
                      type="button"
                      className="flow-run-step-expand"
                      onClick={() => toggleStep(step.id)}
                      aria-expanded={isExpanded}
                      title={isExpanded ? "Hide step log" : "Show step log"}
                    >
                      <Icon name={isExpanded ? "ph:caret-down" : "ph:caret-right"} width={12} />
                    </button>
                  )}
                </div>
                {isExpanded && detail && (
                  <pre className="flow-run-step-detail">{detail}</pre>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!collapsed && (run.sessionId || transcript) && (
        <div className="flow-run-logs">
          <button
            type="button"
            className="flow-run-logs-toggle"
            onClick={() => setLogsOpen((o) => !o)}
            aria-expanded={logsOpen}
          >
            <Icon name={logsOpen ? "ph:caret-down" : "ph:caret-right"} width={12} />
            Session output
            {transcript ? <span className="flow-run-logs-size">{transcript.length} chars</span> : null}
          </button>
          {logsOpen &&
            (transcript ? (
              <pre className="flow-run-logs-body">{transcript.slice(-6000)}</pre>
            ) : (
              <p className="flow-run-logs-empty">
                {running
                  ? "No output from the session yet."
                  : "This run produced no session output."}
              </p>
            ))}
        </div>
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
