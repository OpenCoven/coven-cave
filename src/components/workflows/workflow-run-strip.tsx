"use client";

import { Icon } from "@/lib/icon";
import { isPublicTemplate, workflowIssueSummary, type WorkflowValidationIssue, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowRunStripProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  engineUnavailable: boolean;
  notice: string | null;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
  onPlay: (workflow: WorkflowSummary) => void;
  onSave: (workflow: WorkflowSummary) => void;
  onUndo: () => void;
  onRedo: () => void;
};

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

export function WorkflowRunStrip({
  workflow,
  action,
  busyId,
  dirty,
  canUndo,
  canRedo,
  engineUnavailable,
  notice,
  onValidate,
  onDryRun,
  onPlay,
  onSave,
  onUndo,
  onRedo,
}: WorkflowRunStripProps) {
  const issues = issuesForAction(action);
  const validateBusy = workflow ? busyId === `${workflow.id}:validate` : false;
  const dryRunBusy = workflow ? busyId === `${workflow.id}:dry-run` : false;
  const playBusy = workflow ? busyId === `${workflow.id}:play` : false;
  const saveBusy = workflow ? busyId === `${workflow.id}:save` : false;
  const anyBusy = busyId !== null;
  // Templates are read-only; saving an edit forks a personal copy to ~/.coven.
  const forking = workflow ? isPublicTemplate(workflow) : false;
  const saveLabel = saveBusy ? (forking ? "Forking" : "Saving") : forking ? "Fork & Save" : "Save";

  return (
    <section className="workflow-run-strip" aria-label="Workflow actions">
      <div className="workflow-run-actions">
        <button
          type="button"
          className="workflow-history-button"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo"
          aria-label="Undo edit"
        >
          <Icon name="ph:arrow-counter-clockwise" width={14} />
        </button>
        <button
          type="button"
          className="workflow-history-button"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo"
          aria-label="Redo edit"
        >
          <Icon name="ph:arrow-clockwise" width={14} />
        </button>
        <button
          type="button"
          className="workflow-primary-button"
          disabled={!workflow || anyBusy || !dirty}
          onClick={() => workflow && onSave(workflow)}
          title={
            !dirty
              ? "No unsaved changes"
              : forking
                ? "Read-only template — saves a personal copy to ~/.coven"
                : "Save manifest to disk"
          }
        >
          <Icon name={forking ? "ph:git-fork-bold" : "ph:floppy-disk-bold"} width={14} />
          {saveLabel}
        </button>
        <button type="button" disabled={!workflow || anyBusy} onClick={() => workflow && onValidate(workflow)}>
          <Icon name="ph:check-circle-bold" width={14} />
          {validateBusy ? "Validating" : "Validate"}
        </button>
        <button type="button" disabled={!workflow || anyBusy} onClick={() => workflow && onDryRun(workflow)}>
          <Icon name="ph:rocket-bold" width={14} />
          {dryRunBusy ? "Planning" : "Dry-run"}
        </button>
        <button
          type="button"
          className="workflow-play-button"
          disabled={!workflow || anyBusy || dirty || engineUnavailable}
          onClick={() => workflow && onPlay(workflow)}
          title={
            engineUnavailable
              ? "Run endpoint pending — daemon workflow engine unavailable"
              : dirty
                ? "Save before running"
                : "Execute through the daemon engine"
          }
        >
          <Icon name="ph:lightning-bold" width={14} />
          {playBusy ? "Running" : "Play"}
        </button>
      </div>
      {engineUnavailable && <p className="workflow-run-hint">Run endpoint pending</p>}
      <p className="workflow-run-feedback">
        {notice
          ? notice
          : action
            ? `${action.kind === "validate" ? "Validation" : "Dry-run"} ${action.result.ok ? "ready" : "blocked"} · ${
                action.result.error ?? workflowIssueSummary(issues)
              }`
            : "Validate or dry-run a workflow to preview action feedback."}
      </p>
    </section>
  );
}
