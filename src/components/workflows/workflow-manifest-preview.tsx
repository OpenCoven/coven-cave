"use client";

import { useMemo } from "react";
import { workflowToYaml } from "@/lib/workflow-edit";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowManifestPreviewProps = {
  workflow: WorkflowSummary | null;
  dirty: boolean;
};

/** Live canonical YAML for the current draft — what Save writes to disk. */
export function WorkflowManifestPreview({ workflow, dirty }: WorkflowManifestPreviewProps) {
  const yaml = useMemo(() => (workflow ? workflowToYaml(workflow) : null), [workflow]);

  return (
    <section className="workflow-panel workflow-manifest-preview" aria-label="Workflow manifest preview">
      <div className="workflow-panel-heading">
        <div className="workflow-heading-lead">
          <div>
            <p className="workflow-eyebrow">WORKFLOW.md / .workflow.yaml</p>
            <h2>
              Manifest
              {dirty && <span className="workflow-dirty-dot" title="Unsaved changes" />}
            </h2>
          </div>
        </div>
      </div>
      {yaml ? (
        <pre className="workflow-manifest-yaml">
          <code>{`# schema_version: CWF-01\n${yaml}`}</code>
        </pre>
      ) : (
        <p className="workflow-muted">Select a workflow to preview its canonical manifest.</p>
      )}
      <p className="workflow-muted">Cave-only layout stays in WORKFLOW.cave.json.</p>
    </section>
  );
}
