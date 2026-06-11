"use client";

import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import { workflowIssueSummary, type WorkflowValidationIssue, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowInspectorProps = {
  workflow: WorkflowSummary | null;
  selectedNode: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
};

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

export function WorkflowInspector({ workflow, selectedNode, action }: WorkflowInspectorProps) {
  const issues = issuesForAction(action);

  return (
    <section className="workflow-panel workflow-inspector" aria-label="Workflow inspector">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">Selected node</p>
          <h2>{selectedNode?.data.label ?? "Workflow"}</h2>
        </div>
      </div>

      {selectedNode ? (
        <dl className="workflow-detail-list">
          <div>
            <dt>Kind</dt>
            <dd>{selectedNode.data.kind}</dd>
          </div>
          <div>
            <dt>Uses</dt>
            <dd>{selectedNode.data.uses ?? "No binding"}</dd>
          </div>
          <div>
            <dt>Summary</dt>
            <dd>{selectedNode.data.summary ?? "No node summary"}</dd>
          </div>
        </dl>
      ) : (
        <p className="workflow-muted">Select a graph node to inspect step bindings and dry-run status.</p>
      )}

      <h3>Workflow</h3>
      <dl className="workflow-detail-list">
        <div>
          <dt>ID</dt>
          <dd>{workflow?.id ?? "No workflow selected"}</dd>
        </div>
        <div>
          <dt>Pattern</dt>
          <dd>{workflow?.pattern ?? "Unspecified"}</dd>
        </div>
      </dl>

      <h3>Permissions</h3>
      <p className="workflow-muted">{workflow?.permissions?.join(", ") || "No explicit permissions declared"}</p>

      <h3>Validation</h3>
      <p className="workflow-muted">
        {action ? `${action.kind}: ${action.result.ok ? "ready" : "blocked"} · ${workflowIssueSummary(issues)}` : workflow?.validation_state ?? "unknown"}
      </p>
    </section>
  );
}
