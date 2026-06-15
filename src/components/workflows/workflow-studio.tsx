"use client";

import "@/styles/workflows.css";

import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { WorkflowGraphNode, WorkflowLayoutDirection, WorkflowNodePositions } from "@/lib/workflow-graph";
import type { WorkflowPlaybackState } from "@/lib/workflow-playback";
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
import type { WorkflowFamiliarOption } from "./workflow-attachments";
import { WorkflowCanvas } from "./workflow-canvas";
import { WorkflowCreateDialog, WorkflowScheduleDialog } from "./workflow-create-dialog";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowLibrary } from "./workflow-library";
import { WorkflowManifestPreview } from "./workflow-manifest-preview";
import { WorkflowPalette } from "./workflow-palette";
import { WorkflowRunStrip } from "./workflow-run-strip";
import { WorkflowRunsPanel } from "./workflow-runs-panel";

type WorkflowRunPreviewMode = "compact" | "custom" | "half" | "full" | "split";
type WorkflowSidePanelSection = "inspector" | "attachments" | "manifest";

type WorkflowRunPreviewPreset = {
  id: Exclude<WorkflowRunPreviewMode, "custom">;
  label: string;
  icon: IconName;
  title: string;
};

const WORKFLOW_RUN_PREVIEW_PRESETS: WorkflowRunPreviewPreset[] = [
  { id: "compact", label: "Compact", icon: "ph:rows", title: "Keep runs compact at the bottom" },
  { id: "half", label: "50%", icon: "ph:caret-up-down", title: "Use half-height run preview" },
  { id: "full", label: "Full", icon: "ph:arrows-out-simple", title: "Expand run preview to full height" },
  { id: "split", label: "Side by side", icon: "ph:columns", title: "Show runs beside the workflow view" },
];

const WORKFLOW_SIDE_PANEL_SECTIONS: Array<{
  id: WorkflowSidePanelSection;
  label: string;
  icon: IconName;
}> = [
  { id: "inspector", label: "Inspect", icon: "ph:sliders-horizontal" },
  { id: "attachments", label: "Bind", icon: "ph:paperclip" },
  { id: "manifest", label: "Manifest", icon: "ph:code" },
];

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
  familiarOptions: WorkflowFamiliarOption[];
  roles: WorkflowRoleSummary[];
  engineUnavailable: boolean;
  notice: string | null;
  savedPositions: WorkflowNodePositions | null;
  layoutDirection: WorkflowLayoutDirection;
  viewResetKey: number;
  playback: WorkflowPlaybackState | null;
  onStopPlayback: () => void;
  onReplayRun: (run: WorkflowRunRecord) => void;
  onResetView: () => void;
  onSwitchLayout: () => void;
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
  const [sidePanelSection, setSidePanelSection] = useState<WorkflowSidePanelSection>("inspector");
  const [runPreviewMode, setRunPreviewMode] = useState<WorkflowRunPreviewMode>("compact");
  const [runPreviewHeight, setRunPreviewHeight] = useState(280);
  const [runPreviewSideWidth, setRunPreviewSideWidth] = useState(420);
  const shellClassName = [
    "workflow-studio-shell",
    leftPanelOpen ? "" : "is-left-collapsed",
    rightPanelOpen ? "" : "is-right-collapsed",
  ].filter(Boolean).join(" ");
  const mainClassName = [
    "workflow-studio-main",
    `is-run-preview-${runPreviewMode}`,
  ].join(" ");
  const mainStyle = {
    "--workflow-runs-height": `${runPreviewHeight}px`,
    "--workflow-runs-side-width": `${runPreviewSideWidth}px`,
  } as CSSProperties;

  function startRunPreviewResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const split = runPreviewMode === "split";
    const startX = event.clientX;
    const startY = event.clientY;
    const startHeight = runPreviewHeight;
    const startWidth = runPreviewSideWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (split) {
        const nextWidth = Math.min(760, Math.max(320, startWidth + startX - moveEvent.clientX));
        setRunPreviewSideWidth(nextWidth);
        return;
      }
      const nextHeight = Math.min(720, Math.max(160, startHeight + startY - moveEvent.clientY));
      setRunPreviewMode("custom");
      setRunPreviewHeight(nextHeight);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

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
          <span className="workflow-panel-tab__title">Workflows</span>
          <Icon name={leftPanelOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} className="workflow-panel-tab__icon" />
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
      <main className={mainClassName} style={mainStyle}>
        <WorkflowPalette workflow={selectedWorkflow} onAddStep={props.onAddStep} />
        <WorkflowCanvas
          workflow={selectedWorkflow}
          action={action}
          selectedNode={selectedNode}
          savedPositions={props.savedPositions}
          layoutDirection={props.layoutDirection}
          viewResetKey={props.viewResetKey}
          playback={props.playback}
          onSelectNode={props.onSelectNode}
          onClearNode={props.onClearNode}
          onResetView={props.onResetView}
          onSwitchLayout={props.onSwitchLayout}
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
          playback={props.playback}
          onValidate={props.onValidate}
          onDryRun={props.onDryRun}
          onPlay={props.onPlay}
          onSave={props.onSave}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
          onStopPlayback={props.onStopPlayback}
        />
        <section className="workflow-run-preview-frame" aria-label="Run preview details">
          <button
            type="button"
            className="workflow-run-preview-resizer"
            aria-label="Drag to resize run preview"
            title={runPreviewMode === "split" ? "Drag horizontally to resize run preview" : "Drag vertically to resize run preview"}
            onPointerDown={startRunPreviewResize}
          >
            <Icon name="ph:dots-six-vertical" width={15} aria-hidden />
          </button>
          <div className="workflow-run-preview-toolbar" role="toolbar" aria-label="Run preview layout">
            {WORKFLOW_RUN_PREVIEW_PRESETS.map((preset) => {
              const active = runPreviewMode === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`workflow-run-preview-mode${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  title={preset.title}
                  onClick={() => setRunPreviewMode(preset.id)}
                >
                  <Icon name={preset.icon} width={12} aria-hidden />
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
          <WorkflowRunsPanel
            runs={props.runs}
            loading={props.runsLoading}
            workflow={selectedWorkflow}
            playback={props.playback}
            onReplayRun={props.onReplayRun}
          />
        </section>
      </main>
      <aside className="workflow-studio-side" aria-label="Workflow details">
        <div className="workflow-side-panel-header">
          <div className="workflow-side-panel-tabs" role="tablist" aria-label="Workflow detail sections">
            {WORKFLOW_SIDE_PANEL_SECTIONS.map((section) => {
              const active = sidePanelSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  id={`workflow-side-panel-tab-${section.id}`}
                  aria-selected={active}
                  aria-controls={`workflow-side-panel-${section.id}`}
                  className="workflow-side-panel-tab"
                  title={section.label}
                  onClick={() => {
                    setSidePanelSection(section.id);
                    if (!rightPanelOpen) setRightPanelOpen(true);
                  }}
                >
                  <Icon name={section.icon} width={13} aria-hidden />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="workflow-panel-collapse-button workflow-panel-tab-right"
            aria-label={rightPanelOpen ? "Hide workflow details" : "Show workflow details"}
            aria-expanded={rightPanelOpen}
            title={rightPanelOpen ? "Hide workflow details" : "Show workflow details"}
            onClick={() => setRightPanelOpen((open) => !open)}
          >
            <Icon name={rightPanelOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} className="workflow-panel-tab__icon" />
          </button>
        </div>
        <div className="workflow-studio-side-content">
          <div
            id={`workflow-side-panel-${sidePanelSection}`}
            role="tabpanel"
            aria-labelledby={`workflow-side-panel-tab-${sidePanelSection}`}
          >
            {sidePanelSection === "inspector" && (
              <WorkflowInspector
                workflow={selectedWorkflow}
                selectedNode={selectedNode}
                action={action}
                onUpdateStep={props.onUpdateStep}
                onUpdateMeta={props.onUpdateMeta}
                onRemoveStep={props.onRemoveStep}
              />
            )}
            {sidePanelSection === "attachments" && (
              <WorkflowAttachments
                workflow={selectedWorkflow}
                familiarOptions={props.familiarOptions}
                roles={props.roles}
                onAttachRole={props.onAttachRole}
                onUpdateMeta={props.onUpdateMeta}
                onScheduleRequest={() => setScheduleOpen(true)}
              />
            )}
            {sidePanelSection === "manifest" && (
              <WorkflowManifestPreview workflow={selectedWorkflow} dirty={props.dirty} />
            )}
          </div>
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
