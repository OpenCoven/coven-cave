"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { workflowToYaml } from "@/lib/workflow-edit";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowManifestPreviewProps = {
  workflow: WorkflowSummary | null;
  dirty: boolean;
  /** Top-level fields that differ from the saved manifest (what Save would write). */
  changedFields?: string[];
};

/** Live canonical YAML for the current draft — what Save writes to disk. */
export function WorkflowManifestPreview({ workflow, dirty, changedFields }: WorkflowManifestPreviewProps) {
  const yaml = useMemo(() => (workflow ? workflowToYaml(workflow) : null), [workflow]);
  // The manifest with its schema banner is exactly what Save writes, so copying
  // it hands off a paste-ready manifest (to share, or check in by hand).
  const manifestText = yaml ? `# schema_version: CWF-01\n${yaml}` : null;
  const [copied, setCopied] = useState(false);

  const copyManifest = async () => {
    if (!manifestText) return;
    try {
      await navigator.clipboard.writeText(manifestText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard can be blocked (permissions / insecure context); silently no-op
    }
  };

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
        {manifestText && (
          <button
            type="button"
            className="workflow-icon-button"
            onClick={copyManifest}
            title="Copy manifest YAML"
            aria-label={copied ? "Manifest copied" : "Copy manifest YAML"}
          >
            <Icon name={copied ? "ph:check-bold" : "ph:copy"} width={13} />
          </button>
        )}
      </div>
      {dirty && changedFields && changedFields.length > 0 && (
        <p className="workflow-manifest-changes">
          <Icon name="ph:pencil-simple" width={12} aria-hidden />
          Unsaved changes: {changedFields.join(", ")}
        </p>
      )}
      {manifestText ? (
        <pre className="workflow-manifest-yaml">
          <code>{manifestText}</code>
        </pre>
      ) : (
        <p className="workflow-muted">Select a workflow to preview its canonical manifest.</p>
      )}
      <p className="workflow-muted">Cave-only layout stays in WORKFLOW.cave.json.</p>
    </section>
  );
}
