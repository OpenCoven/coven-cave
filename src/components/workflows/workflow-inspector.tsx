"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import {
  workflowIssueSummary,
  type WorkflowStepSummary,
  type WorkflowSummary,
  type WorkflowValidationIssue,
} from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowInspectorProps = {
  workflow: WorkflowSummary | null;
  selectedNode: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
  onUpdateStep: (id: string, patch: Partial<WorkflowStepSummary>) => void;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
  onRemoveStep: (id: string) => void;
};

const STEP_KINDS = ["agent", "skill", "tool", "human-gate", "workflow"];

const PATTERNS = [
  "sequential",
  "fan-out-and-synthesize",
  "classify-and-act",
  "adversarial-verification",
  "generate-and-filter",
  "tournament",
  "loop-until-done",
  "custom",
];

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

function parseCsv(value: string): string[] | undefined {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function Field({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
}) {
  return (
    <label className="workflow-field">
      <span>{label}</span>
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        key={`${label}:${value}`}
        onBlur={(event) => {
          if (event.target.value !== value) onCommit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/** Step editor when a node is selected; workflow meta editor otherwise. */
export function WorkflowInspector({
  workflow,
  selectedNode,
  action,
  onUpdateStep,
  onUpdateMeta,
  onRemoveStep,
}: WorkflowInspectorProps) {
  const issues = issuesForAction(action);
  const [open, setOpen] = useState(false);
  const step = selectedNode
    ? workflow?.steps?.find((entry) => entry.id === selectedNode.id) ?? null
    : null;

  return (
    <section className="workflow-panel workflow-inspector" aria-label="Workflow inspector">
      <div className="workflow-panel-heading">
        <div className="workflow-heading-lead">
          <button
            type="button"
            className="workflow-section-caret-btn"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} inspector`}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={12} aria-hidden />
          </button>
          <div>
            <p className="workflow-eyebrow">{step ? "Selected node" : "Workflow"}</p>
            <h2>{step ? (step.name ?? step.id) : (workflow?.name ?? workflow?.id ?? "No workflow")}</h2>
          </div>
        </div>
        {step && (
          <button
            type="button"
            className="workflow-icon-button workflow-icon-button-danger"
            onClick={() => onRemoveStep(step.id)}
            title="Remove step"
            aria-label={`Remove step ${step.id}`}
          >
            <Icon name="ph:trash" width={13} />
          </button>
        )}
      </div>

      {open && (
      <>
      {step ? (
        <div className="workflow-editor">
          <Field label="Name" value={step.name ?? ""} onCommit={(next) => onUpdateStep(step.id, { name: next || undefined })} />
          <Field
            label="ID"
            value={step.id}
            onCommit={(next) => {
              const id = next.trim();
              if (id) onUpdateStep(step.id, { id });
            }}
          />
          <label className="workflow-field">
            <span>Kind</span>
            <select value={step.kind} onChange={(event) => onUpdateStep(step.id, { kind: event.target.value })}>
              {STEP_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
              {!STEP_KINDS.includes(step.kind) && <option value={step.kind}>{step.kind}</option>}
            </select>
          </label>
          <Field
            label="Uses"
            value={step.uses ?? ""}
            placeholder="nova · cwf-validator@^1.0.0 · cave.output"
            onCommit={(next) => onUpdateStep(step.id, { uses: next || undefined })}
          />
          <Field
            label="Summary"
            value={step.summary ?? ""}
            onCommit={(next) => onUpdateStep(step.id, { summary: next || undefined })}
          />
          <Field
            label="Permissions"
            value={(step.permissions ?? []).join(", ")}
            placeholder="repo.read, web.fetch"
            onCommit={(next) => onUpdateStep(step.id, { permissions: parseCsv(next) })}
          />
          <Field
            label="On error"
            value={step.on_error ?? ""}
            placeholder="retry · halt · escalate"
            onCommit={(next) => onUpdateStep(step.id, { on_error: next || undefined })}
          />
          <p className="workflow-muted">
            Requires: {step.requires?.length ? step.requires.join(", ") : "none"} — draw edges on the
            canvas to change dependencies.
          </p>
        </div>
      ) : workflow ? (
        <div className="workflow-editor">
          <Field label="Name" value={workflow.name ?? ""} onCommit={(next) => onUpdateMeta({ name: next || undefined })} />
          <Field label="Version" value={workflow.version} onCommit={(next) => onUpdateMeta({ version: next || workflow.version })} />
          <label className="workflow-field">
            <span>Pattern</span>
            <select
              value={workflow.pattern ?? "custom"}
              onChange={(event) => onUpdateMeta({ pattern: event.target.value })}
            >
              {PATTERNS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {pattern}
                </option>
              ))}
              {workflow.pattern && !PATTERNS.includes(workflow.pattern) && (
                <option value={workflow.pattern}>{workflow.pattern}</option>
              )}
            </select>
          </label>
          <Field
            label="Summary"
            value={workflow.summary ?? ""}
            onCommit={(next) => onUpdateMeta({ summary: next || undefined })}
          />
          <Field
            label="Tags"
            value={(workflow.tags ?? []).join(", ")}
            placeholder="library, annotation"
            onCommit={(next) => onUpdateMeta({ tags: parseCsv(next) })}
          />
          <Field
            label="Permissions"
            value={(workflow.permissions ?? []).join(", ")}
            placeholder="repo.read, web.fetch"
            onCommit={(next) => onUpdateMeta({ permissions: parseCsv(next) })}
          />
          <div className="workflow-limits-row">
            <Field
              label="Max agents"
              value={workflow.limits?.max_agents?.toString() ?? ""}
              onCommit={(next) =>
                onUpdateMeta({
                  limits: { ...workflow.limits, max_agents: next ? Number(next) || undefined : undefined },
                })
              }
            />
            <Field
              label="Timeout (s)"
              value={workflow.limits?.timeout_s?.toString() ?? ""}
              onCommit={(next) =>
                onUpdateMeta({
                  limits: { ...workflow.limits, timeout_s: next ? Number(next) || undefined : undefined },
                })
              }
            />
            <Field
              label="Cost ceiling ($)"
              value={workflow.limits?.cost_ceiling_usd?.toString() ?? ""}
              onCommit={(next) =>
                onUpdateMeta({
                  limits: { ...workflow.limits, cost_ceiling_usd: next ? Number(next) || undefined : undefined },
                })
              }
            />
          </div>
        </div>
      ) : (
        <p className="workflow-muted">Select a workflow to edit its manifest.</p>
      )}

      <h3>Validation</h3>
      <p className="workflow-muted">
        {action
          ? `${action.kind}: ${action.result.ok ? "ready" : "blocked"} · ${workflowIssueSummary(issues)}`
          : workflow?.validation_state ?? "unknown"}
      </p>
      {issues.length > 0 && (
        <ul className="workflow-issue-list">
          {issues.slice(0, 6).map((issue, index) => (
            <li key={`${issue.code}:${issue.path ?? index}`}>
              <span className={`workflow-issue-tier workflow-issue-${issue.tier}`}>{issue.tier}</span>
              <span>
                {issue.message ?? issue.code}
                {issue.suggestion ? ` — ${issue.suggestion}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </section>
  );
}
