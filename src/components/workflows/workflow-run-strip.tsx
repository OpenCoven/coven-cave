"use client";

import { Icon } from "@/lib/icon";
import { workflowIssueSummary, type WorkflowValidationIssue, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowRunStripProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
};

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

export function WorkflowRunStrip({ workflow, action, busyId, onValidate, onDryRun }: WorkflowRunStripProps) {
  const issues = issuesForAction(action);
  const validateBusy = workflow ? busyId === `${workflow.id}:validate` : false;
  const dryRunBusy = workflow ? busyId === `${workflow.id}:dry-run` : false;

  return (
    <section className="workflow-run-strip" aria-label="Workflow actions">
      <div className="workflow-run-actions">
        <button type="button" disabled={!workflow || busyId !== null} onClick={() => workflow && onValidate(workflow)}>
          <Icon name="ph:check-circle-bold" width={14} />
          {validateBusy ? "Validating" : "Validate"}
        </button>
        <button type="button" disabled={!workflow || busyId !== null} onClick={() => workflow && onDryRun(workflow)}>
          <Icon name="ph:rocket-bold" width={14} />
          {dryRunBusy ? "Planning" : "Dry-run"}
        </button>
        <button type="button" disabled title="Run endpoint pending">
          <Icon name="ph:lightning-bold" width={14} />
          Play
        </button>
      </div>
      <p className="workflow-run-feedback">
        {action
          ? `${action.kind === "validate" ? "Validation" : "Dry-run"} ${action.result.ok ? "ready" : "blocked"} · ${
              action.result.error ?? workflowIssueSummary(issues)
            }`
          : "Validate or dry-run a workflow to preview action feedback."}
      </p>
    </section>
  );
}
