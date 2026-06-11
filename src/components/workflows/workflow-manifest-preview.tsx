"use client";

import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowManifestPreviewProps = {
  workflow: WorkflowSummary | null;
};

export function WorkflowManifestPreview({ workflow }: WorkflowManifestPreviewProps) {
  const limits = workflow?.limits;

  return (
    <section className="workflow-panel workflow-manifest-preview" aria-label="Workflow manifest preview">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">WORKFLOW.md / .workflow.yaml</p>
          <h2>Manifest</h2>
        </div>
      </div>
      <dl className="workflow-detail-list">
        <div>
          <dt>schema_version</dt>
          <dd>CWF-01</dd>
        </div>
        <div>
          <dt>id</dt>
          <dd>{workflow?.id ?? "Select a workflow"}</dd>
        </div>
        <div>
          <dt>version</dt>
          <dd>{workflow?.version ?? "n/a"}</dd>
        </div>
        <div>
          <dt>pattern</dt>
          <dd>{workflow?.pattern ?? "custom"}</dd>
        </div>
        <div>
          <dt>familiar</dt>
          <dd>{workflow?.familiar ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt>limits</dt>
          <dd>
            agents {limits?.max_agents ?? "n/a"} · timeout {limits?.timeout_s ?? "n/a"}s · cost $
            {limits?.cost_ceiling_usd ?? "n/a"}
          </dd>
        </div>
        <div>
          <dt>step count</dt>
          <dd>{workflow?.steps?.length ?? 0}</dd>
        </div>
      </dl>
      <p className="workflow-muted">Cave-only layout stays in WORKFLOW.cave.json.</p>
    </section>
  );
}
