"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { workflowToYaml } from "@/lib/workflow-edit";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowManifestPreviewProps = {
  workflow: WorkflowSummary | null;
  dirty: boolean;
};

/** Live canonical YAML for the current draft — what Save writes to disk. */
export function WorkflowManifestPreview({ workflow, dirty }: WorkflowManifestPreviewProps) {
  const [open, setOpen] = useState(false);
  const yaml = useMemo(() => (workflow ? workflowToYaml(workflow) : null), [workflow]);

  return (
    <section className="workflow-panel workflow-manifest-preview" aria-label="Workflow manifest preview">
      <div className="workflow-panel-heading">
        <div className="workflow-heading-lead">
          <button
            type="button"
            className="workflow-section-caret-btn"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} Manifest`}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={12} aria-hidden />
          </button>
          <div>
            <p className="workflow-eyebrow">WORKFLOW.md / .workflow.yaml</p>
            <h2>
              Manifest
              {dirty && <span className="workflow-dirty-dot" title="Unsaved changes" />}
            </h2>
          </div>
        </div>
      </div>
      {open && (
        <>
          {yaml ? (
            <pre className="workflow-manifest-yaml">
              <code>{`# schema_version: CWF-01\n${yaml}`}</code>
            </pre>
          ) : (
            <p className="workflow-muted">Select a workflow to preview its canonical manifest.</p>
          )}
          <p className="workflow-muted">Cave-only layout stays in WORKFLOW.cave.json.</p>
        </>
      )}
    </section>
  );
}
