"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Tabs } from "@/components/ui/tabs";
import { workflowToYaml } from "@/lib/workflow-edit";
import { buildWorkflowRunPrompt } from "@/lib/workflow-run-prompt";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowManifestPreviewProps = {
  workflow: WorkflowSummary | null;
  dirty: boolean;
  /** Top-level fields that differ from the saved manifest (what Save would write). */
  changedFields?: string[];
};

type ManifestView = "manifest" | "prompt";

/**
 * Two honest views of the current draft: the canonical YAML manifest (what Save
 * writes) and the compiled run prompt (what the agent is actually told when you
 * Play). The run prompt is the same `buildWorkflowRunPrompt` the run route uses,
 * so the preview can't drift from the real execution.
 */
export function WorkflowManifestPreview({ workflow, dirty, changedFields }: WorkflowManifestPreviewProps) {
  const [view, setView] = useState<ManifestView>("manifest");
  const [copied, setCopied] = useState(false);

  const yaml = useMemo(() => (workflow ? workflowToYaml(workflow) : null), [workflow]);
  const manifestText = yaml ? `# schema_version: CWF-01\n${yaml}` : null;
  // No inputs here: the preview shows the prompt's structure; the actual values
  // are captured by the run-inputs dialog and filled in at Play time.
  const promptText = useMemo(() => (workflow ? buildWorkflowRunPrompt(workflow) : null), [workflow]);

  const activeText = view === "manifest" ? manifestText : promptText;

  const copyActive = async () => {
    if (!activeText) return;
    try {
      await navigator.clipboard.writeText(activeText);
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
            <p className="workflow-eyebrow">
              {view === "manifest" ? "WORKFLOW.md / .workflow.yaml" : "What the agent is told on Play"}
            </p>
            <h2>
              {view === "manifest" ? "Manifest" : "Run prompt"}
              {dirty && <span className="workflow-dirty-dot" title="Unsaved changes" />}
            </h2>
          </div>
        </div>
        {activeText && (
          <button
            type="button"
            className="workflow-icon-button"
            onClick={copyActive}
            title={view === "manifest" ? "Copy manifest YAML" : "Copy run prompt"}
            aria-label={copied ? "Copied" : view === "manifest" ? "Copy manifest YAML" : "Copy run prompt"}
          >
            <Icon name={copied ? "ph:check-bold" : "ph:copy"} width={13} />
          </button>
        )}
      </div>
      {workflow && (
        <Tabs
          variant="segment"
          size="sm"
          className="shrink-0"
          ariaLabel="Preview mode"
          value={view}
          onChange={setView}
          items={[
            { id: "manifest", label: "Manifest" },
            { id: "prompt", label: "Run prompt" },
          ]}
        />
      )}
      {view === "manifest" && dirty && changedFields && changedFields.length > 0 && (
        <p className="workflow-manifest-changes">
          <Icon name="ph:pencil-simple" width={12} aria-hidden />
          Unsaved changes: {changedFields.join(", ")}
        </p>
      )}
      {activeText ? (
        <pre className="workflow-manifest-yaml">
          <code>{activeText}</code>
        </pre>
      ) : (
        <p className="workflow-muted">Select a workflow to preview its canonical manifest.</p>
      )}
      <p className="workflow-muted">
        {view === "manifest"
          ? "Cave-only layout stays in WORKFLOW.cave.json."
          : "Run inputs are filled in at Play time; this preview leaves them blank."}
      </p>
    </section>
  );
}
