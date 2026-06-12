"use client";

import "@/styles/workflows.css";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { WorkflowGraphNode, WorkflowNodePositions } from "@/lib/workflow-graph";
import type {
  WorkflowDryRunPlan,
  WorkflowPattern,
  WorkflowRoleSummary,
  WorkflowRunRecord,
  WorkflowScheduleRecurrence,
  WorkflowStepKind,
  WorkflowStepSummary,
  WorkflowSummary,
  WorkflowValidationResult,
} from "@/lib/workflows";
import { WorkflowAttachments } from "./workflow-attachments";
import { WorkflowCanvas } from "./workflow-canvas";
import { WorkflowCreateDialog, WorkflowScheduleDialog } from "./workflow-create-dialog";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowLibrary } from "./workflow-library";
import { WorkflowManifestPreview } from "./workflow-manifest-preview";
import { WorkflowPalette } from "./workflow-palette";
import { WorkflowRunStrip } from "./workflow-run-strip";
import { WorkflowRunsPanel } from "./workflow-runs-panel";

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
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  runs: WorkflowRunRecord[];
  runsLoading: boolean;
  roles: WorkflowRoleSummary[];
  engineUnavailable: boolean;
  notice: string | null;
  savedPositions: WorkflowNodePositions | null;
  onRefresh: () => void;
  onSelectWorkflow: (workflow: WorkflowSummary) => void;
  onSelectNode: (node: WorkflowGraphNode) => void;
  onClearNode: () => void;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
  onPlay: (workflow: WorkflowSummary) => void;
  onSave: (workflow: WorkflowSummary) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddStep: (kind: WorkflowStepKind) => void;
  onUpdateStep: (id: string, patch: Partial<WorkflowStepSummary>) => void;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
  onRemoveStep: (id: string) => void;
  onConnect: (source: string, target: string) => void;
  onSavePositions: (positions: WorkflowNodePositions) => void;
  onDisconnect: (source: string, target: string) => void;
  onCreate: (input: { name: string; pattern: WorkflowPattern; familiar?: string }) => void;
  onDuplicate: (workflow: WorkflowSummary) => void;
  onDelete: (workflow: WorkflowSummary) => void;
  onAttachRole: (role: WorkflowRoleSummary, attach: boolean) => void;
  onSchedule: (fireAt: string, recurrence: WorkflowScheduleRecurrence) => void;
};

export function WorkflowStudio(props: WorkflowStudioProps) {
  const {
    workflows,
    selectedWorkflow,
    selectedNode,
    action,
    busyId,
    loaded,
    refreshing,
    error,
  } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const shellClassName = [
    "workflow-studio-shell",
    leftPanelOpen ? "" : "is-left-collapsed",
    rightPanelOpen ? "" : "is-right-collapsed",
  ].filter(Boolean).join(" ");

  return (
    <section className={shellClassName} aria-label="Workflow Studio">
      <aside className="workflow-studio-library-panel" aria-label="Workflow library">
        <button
          type="button"
          className="workflow-panel-tab workflow-panel-tab-left"
          aria-label={leftPanelOpen ? "Hide workflow library" : "Show workflow library"}
          aria-expanded={leftPanelOpen}
          title={leftPanelOpen ? "Hide workflow library" : "Show workflow library"}
          onClick={() => setLeftPanelOpen((open) => !open)}
        >
          <Icon name={leftPanelOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} />
        </button>
        <div className="workflow-studio-library-content">
          <WorkflowLibrary
            workflows={workflows}
            selectedWorkflow={selectedWorkflow}
            loaded={loaded}
            refreshing={refreshing}
            error={error}
            dirty={props.dirty}
            onRefresh={props.onRefresh}
            onSelectWorkflow={props.onSelectWorkflow}
            onCreateRequest={() => setCreateOpen(true)}
            onDuplicate={props.onDuplicate}
            onDelete={props.onDelete}
          />
        </div>
      </aside>
      <main className="workflow-studio-main">
        <WorkflowPalette workflow={selectedWorkflow} onAddStep={props.onAddStep} />
        <WorkflowCanvas
          workflow={selectedWorkflow}
          action={action}
          selectedNode={selectedNode}
          savedPositions={props.savedPositions}
          onSelectNode={props.onSelectNode}
          onClearNode={props.onClearNode}
          onConnect={props.onConnect}
          onDisconnect={props.onDisconnect}
          onRemoveStep={props.onRemoveStep}
          onSavePositions={props.onSavePositions}
        />
        <WorkflowRunStrip
          workflow={selectedWorkflow}
          action={action}
          busyId={busyId}
          dirty={props.dirty}
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          engineUnavailable={props.engineUnavailable}
          notice={props.notice}
          onValidate={props.onValidate}
          onDryRun={props.onDryRun}
          onPlay={props.onPlay}
          onSave={props.onSave}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
        <WorkflowRunsPanel runs={props.runs} loading={props.runsLoading} workflow={selectedWorkflow} />
      </main>
      <aside className="workflow-studio-side" aria-label="Workflow details">
        <button
          type="button"
          className="workflow-panel-tab workflow-panel-tab-right"
          aria-label={rightPanelOpen ? "Hide workflow details" : "Show workflow details"}
          aria-expanded={rightPanelOpen}
          title={rightPanelOpen ? "Hide workflow details" : "Show workflow details"}
          onClick={() => setRightPanelOpen((open) => !open)}
        >
          <Icon name={rightPanelOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} />
        </button>
        <div className="workflow-studio-side-content">
          <WorkflowInspector
            workflow={selectedWorkflow}
            selectedNode={selectedNode}
            action={action}
            onUpdateStep={props.onUpdateStep}
            onUpdateMeta={props.onUpdateMeta}
            onRemoveStep={props.onRemoveStep}
          />
          <WorkflowAttachments
            workflow={selectedWorkflow}
            roles={props.roles}
            onAttachRole={props.onAttachRole}
            onUpdateMeta={props.onUpdateMeta}
            onScheduleRequest={() => setScheduleOpen(true)}
          />
          <WorkflowManifestPreview workflow={selectedWorkflow} dirty={props.dirty} />
        </div>
      </aside>
      {createOpen && (
        <WorkflowCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreate={(input) => {
            setCreateOpen(false);
            props.onCreate(input);
          }}
        />
      )}
      {scheduleOpen && selectedWorkflow && (
        <WorkflowScheduleDialog
          workflow={selectedWorkflow}
          onClose={() => setScheduleOpen(false)}
          onSchedule={(fireAt, recurrence) => {
            setScheduleOpen(false);
            props.onSchedule(fireAt, recurrence);
          }}
        />
      )}
    </section>
  );
}
