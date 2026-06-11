"use client";

import "@/styles/workflows.css";

import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import type {
  WorkflowDryRunPlan,
  WorkflowSummary,
  WorkflowValidationResult,
} from "@/lib/workflows";
import { WorkflowAttachments } from "./workflow-attachments";
import { WorkflowCanvas } from "./workflow-canvas";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowLibrary } from "./workflow-library";
import { WorkflowManifestPreview } from "./workflow-manifest-preview";
import { WorkflowRunStrip } from "./workflow-run-strip";

export type WorkflowStudioActionState = {
  id: string;
  kind: "validate" | "dry-run";
  result: WorkflowValidationResult | WorkflowDryRunPlan;
};

export type WorkflowStudioProps = {
  workflows: WorkflowSummary[];
  selectedWorkflow: WorkflowSummary | null;
  selectedNode: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectWorkflow: (workflow: WorkflowSummary) => void;
  onSelectNode: (node: WorkflowGraphNode) => void;
  onClearNode: () => void;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
};

export function WorkflowStudio({
  workflows,
  selectedWorkflow,
  selectedNode,
  action,
  busyId,
  loaded,
  refreshing,
  error,
  onRefresh,
  onSelectWorkflow,
  onSelectNode,
  onClearNode,
  onValidate,
  onDryRun,
}: WorkflowStudioProps) {
  const selectedAction = action && selectedWorkflow?.id === action.id ? action : null;

  return (
    <section className="workflow-studio-shell" aria-label="Workflow Studio">
      <WorkflowLibrary
        workflows={workflows}
        selectedWorkflow={selectedWorkflow}
        loaded={loaded}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onSelectWorkflow={onSelectWorkflow}
      />
      <main className="workflow-studio-main">
        <WorkflowCanvas
          workflow={selectedWorkflow}
          action={selectedAction}
          selectedNode={selectedNode}
          onSelectNode={onSelectNode}
          onClearNode={onClearNode}
        />
        <WorkflowRunStrip
          workflow={selectedWorkflow}
          action={selectedAction}
          busyId={busyId}
          onValidate={onValidate}
          onDryRun={onDryRun}
        />
      </main>
      <aside className="workflow-studio-side" aria-label="Workflow details">
        <WorkflowInspector workflow={selectedWorkflow} selectedNode={selectedNode} action={selectedAction} />
        <WorkflowAttachments workflow={selectedWorkflow} />
        <WorkflowManifestPreview workflow={selectedWorkflow} />
      </aside>
    </section>
  );
}
