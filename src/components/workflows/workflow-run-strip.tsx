"use client";

import { Icon, type IconName } from "@/lib/icon";
import {
  activeStepId,
  playbackFinished,
  playbackSummary,
  type WorkflowPlaybackState,
} from "@/lib/workflow-playback";
import { isPublicTemplate, workflowIssueSummary, workflowRunBlockReason, type WorkflowValidationIssue, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowRunStripProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  engineUnavailable: boolean;
  notice: string | null;
  playback: WorkflowPlaybackState | null;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
  onPlay: (workflow: WorkflowSummary) => void;
  onSave: (workflow: WorkflowSummary) => void;
  onUndo: () => void;
  onRedo: () => void;
  onStopPlayback: () => void;
  /** Jump to the live agent session a session-executor run spawned. */
  onOpenSession: (sessionId: string) => void;
};

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

const PLAYBACK_SOURCE_LABEL: Record<WorkflowPlaybackState["source"], string> = {
  "dry-run": "Dry-run preview",
  play: "Plan preview",
  replay: "Replay",
};

const PLAYBACK_SOURCE_ICON: Record<WorkflowPlaybackState["source"], IconName> = {
  "dry-run": "ph:rocket-bold",
  play: "ph:lightning-bold",
  replay: "ph:arrow-counter-clockwise",
};

export function WorkflowRunStrip({
  workflow,
  action,
  busyId,
  dirty,
  canUndo,
  canRedo,
  engineUnavailable,
  notice,
  playback,
  onValidate,
  onDryRun,
  onPlay,
  onSave,
  onUndo,
  onRedo,
  onStopPlayback,
  onOpenSession,
}: WorkflowRunStripProps) {
  const issues = issuesForAction(action);
  const validateBusy = workflow ? busyId === `${workflow.id}:validate` : false;
  const dryRunBusy = workflow ? busyId === `${workflow.id}:dry-run` : false;
  const playBusy = workflow ? busyId === `${workflow.id}:play` : false;
  const saveBusy = workflow ? busyId === `${workflow.id}:save` : false;
  const anyBusy = busyId !== null;
  // Templates are read-only; saving an edit forks a personal copy to ~/.coven.
  const forking = workflow ? isPublicTemplate(workflow) : false;
  const saveLabel = saveBusy ? (forking ? "Forking" : "Saving") : forking ? "Fork & Save" : "Save";
  // The I/O contract gate: no input node (no defined input) or no output node
  // (no produced artifact) ⇒ the workflow can't be run.
  const ioBlock = workflowRunBlockReason(workflow);

  // Playback transport: when a plan/run is walking the graph, surface progress,
  // the live step, and a stop control. Cleared by switching workflows or stop.
  const activePlayback = playback && playback.workflowId === workflow?.id ? playback : null;
  const playbackRunning = activePlayback ? !playbackFinished(activePlayback) : false;
  const activeId = activePlayback ? activeStepId(activePlayback) : null;
  const activeStepLabel = activeId
    ? workflow?.steps?.find((step) => step.id === activeId)?.name ?? activeId
    : null;

  return (
    <section className="workflow-run-strip" aria-label="Workflow actions">
      <div className="workflow-run-actions">
        <button
          type="button"
          className="workflow-history-button"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo"
          aria-label="Undo edit"
        >
          <Icon name="ph:arrow-counter-clockwise" width={14} />
        </button>
        <button
          type="button"
          className="workflow-history-button"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo"
          aria-label="Redo edit"
        >
          <Icon name="ph:arrow-clockwise" width={14} />
        </button>
        <button
          type="button"
          className="workflow-primary-button"
          disabled={!workflow || anyBusy || !dirty}
          onClick={() => workflow && onSave(workflow)}
          title={
            !dirty
              ? "No unsaved changes"
              : forking
                ? "Read-only template — saves a personal copy to ~/.coven"
                : "Save manifest to disk"
          }
        >
          <Icon name={forking ? "ph:git-fork-bold" : "ph:floppy-disk-bold"} width={14} />
          {saveLabel}
        </button>
        <button type="button" className="workflow-run-action-button" disabled={!workflow || anyBusy} onClick={() => workflow && onValidate(workflow)}>
          <Icon name="ph:check-circle-bold" width={14} />
          {validateBusy ? "Validating" : "Validate"}
        </button>
        <button type="button" className="workflow-run-action-button" disabled={!workflow || anyBusy} onClick={() => workflow && onDryRun(workflow)}>
          <Icon name="ph:rocket-bold" width={14} />
          {dryRunBusy ? "Planning" : "Dry-run"}
        </button>
        <button
          type="button"
          className="workflow-play-button"
          aria-label="Play workflow"
          disabled={!workflow || anyBusy || dirty || ioBlock !== null}
          onClick={() => workflow && onPlay(workflow)}
          title={
            ioBlock
              ? ioBlock
              : dirty
                ? "Save before running"
                : engineUnavailable
                  ? "Daemon offline — plays the plan as a preview, no execution"
                  : "Run the workflow as a live agent session"
          }
        >
          <Icon name="ph:lightning-bold" width={14} />
          {playBusy ? "Running" : "Play"}
        </button>
      </div>
      {activePlayback ? (
        <div
          className={`workflow-playback-transport workflow-playback-${activePlayback.source}${playbackRunning ? " is-running" : " is-done"}`}
          role="status"
          aria-live="polite"
        >
          <Icon name={PLAYBACK_SOURCE_ICON[activePlayback.source]} width={13} />
          <span className="workflow-playback-source">{PLAYBACK_SOURCE_LABEL[activePlayback.source]}</span>
          <span className="workflow-playback-progress">{playbackSummary(activePlayback)}</span>
          {playbackRunning && !activePlayback.live && activeStepLabel && (
            <span className="workflow-playback-active" title={activeStepLabel}>
              {activeStepLabel}
            </span>
          )}
          {activePlayback.live ? (
            <>
              <span className="workflow-playback-live">executing in agent session</span>
              {activePlayback.sessionId && (
                <button
                  type="button"
                  className="workflow-playback-open"
                  onClick={() => onOpenSession(activePlayback.sessionId!)}
                  title="Open the live agent session in Chat"
                >
                  <Icon name="ph:arrow-square-out-bold" width={12} />
                  Open in Chat
                </button>
              )}
            </>
          ) : (
            activePlayback.source !== "replay" && (
              <span className="workflow-playback-honesty">preview · not a live execution</span>
            )
          )}
          <button
            type="button"
            className="workflow-playback-stop"
            onClick={onStopPlayback}
            title={playbackRunning ? "Stop playback" : "Clear playback"}
          >
            <Icon name={playbackRunning ? "ph:stop-fill" : "ph:x-bold"} width={12} />
            {playbackRunning ? "Stop" : "Clear"}
          </button>
        </div>
      ) : (
        <>
          {engineUnavailable && (
            <p className="workflow-run-hint">Daemon offline — Play shows a plan preview</p>
          )}
          <p className="workflow-run-feedback">
            {notice
              ? notice
              : action
                ? `${action.kind === "validate" ? "Validation" : "Dry-run"} ${action.result.ok ? "ready" : "blocked"} · ${
                    action.result.error ?? workflowIssueSummary(issues)
                  }`
                : ioBlock
                  ? ioBlock
                  : "Validate to check the manifest · Dry-run previews · Play runs it as a live agent session."}
          </p>
        </>
      )}
    </section>
  );
}
