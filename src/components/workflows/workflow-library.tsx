"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowLibraryProps = {
  workflows: WorkflowSummary[];
  selectedWorkflow: WorkflowSummary | null;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectWorkflow: (workflow: WorkflowSummary) => void;
};

const validationLabels: Record<NonNullable<WorkflowSummary["validation_state"]>, string> = {
  valid: "Ready",
  warning: "Warnings",
  invalid: "Blocked",
  unknown: "Unknown",
};

export function WorkflowLibrary({
  workflows,
  selectedWorkflow,
  loaded,
  refreshing,
  error,
  onRefresh,
  onSelectWorkflow,
}: WorkflowLibraryProps) {
  return (
    <aside className="workflow-library" aria-label="Workflow library">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">Library</p>
          <h2>Workflows</h2>
        </div>
        <button
          type="button"
          className="workflow-icon-button"
          onClick={onRefresh}
          disabled={refreshing}
          title={refreshing ? "Refreshing workflows" : "Refresh workflows"}
          aria-label={refreshing ? "Refreshing workflows" : "Refresh workflows"}
        >
          <Icon name="ph:arrows-clockwise-bold" width={14} className={refreshing ? "animate-spin" : undefined} />
        </button>
      </div>

      {!loaded ? (
        <div className="workflow-library-state">Loading workflow manifests...</div>
      ) : error ? (
        <div className="workflow-library-state workflow-library-state-error">Workflows unavailable: {error}</div>
      ) : workflows.length === 0 ? (
        <div className="workflow-library-state">No WORKFLOW.md or .workflow.yaml manifests found.</div>
      ) : (
        <div className="workflow-library-list">
          {workflows.map((workflow) => {
            const active = selectedWorkflow?.id === workflow.id;
            const validationState = workflow.validation_state ?? "unknown";
            return (
              <button
                key={`${workflow.id}:${workflow.path ?? ""}`}
                type="button"
                className={`workflow-library-item${active ? " is-active" : ""}`}
                onClick={() => onSelectWorkflow(workflow)}
              >
                <span className="workflow-library-item-title">{workflow.name ?? workflow.id}</span>
                <span className="workflow-library-item-meta">
                  <span className={`workflow-health workflow-health-${validationState}`} />
                  {validationLabels[validationState]} · v{workflow.version}
                </span>
                {workflow.summary && <span className="workflow-library-item-summary">{workflow.summary}</span>}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
