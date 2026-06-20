"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import { wouldCreateCycle } from "@/lib/workflow-draft";
import {
  workflowInputSteps,
  workflowIssueSummary,
  workflowOutputSteps,
  workflowRunBlockReason,
  type WorkflowDryRunPlan,
  type WorkflowStepKind,
  type WorkflowStepSummary,
  type WorkflowSummary,
  type WorkflowValidationIssue,
} from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

/** A binding candidate for a step's `uses` field (familiar, skill, tool, sub-workflow). */
export type WorkflowUsesOption = {
  value: string;
  /** Short origin label shown beside the value in the suggestion list. */
  group: string;
};

type WorkflowInspectorProps = {
  workflow: WorkflowSummary | null;
  selectedNode: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
  /** Binding candidates offered as `uses` autocomplete. */
  usesOptions?: WorkflowUsesOption[];
  onUpdateStep: (id: string, patch: Partial<WorkflowStepSummary>) => void;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
  onRemoveStep: (id: string) => void;
  /** Jump to a step by id (e.g. from a validation issue that names it). */
  onSelectStep?: (id: string) => void;
  /** Make `target` require `source` (same edge the canvas draws). */
  onConnect?: (source: string, target: string) => void;
  /** Drop the `target`-requires-`source` dependency. */
  onDisconnect?: (source: string, target: string) => void;
};

/** The step a validation issue points at, resolved from its path (longest id wins). */
function stepIdForIssue(issue: WorkflowValidationIssue, steps: WorkflowStepSummary[]): string | null {
  if (!issue.path) return null;
  let best: string | null = null;
  for (const step of steps) {
    if (issue.path.includes(step.id) && (!best || step.id.length > best.length)) best = step.id;
  }
  return best;
}

// The canonical CWF-01 step-kind vocabulary, in execution order so the dropdown
// mirrors the palette (Input first, Output last). Kept in sync with the palette
// and the run gate (workflowRunBlockReason) — input/output belong here so a step
// can be reclassified into the I/O kinds the runner requires, not just the
// middle kinds. Labels match the palette's casing ("Human gate", not the raw id).
const STEP_KINDS: Array<{ value: WorkflowStepKind; label: string }> = [
  { value: "input", label: "Input" },
  { value: "agent", label: "Agent" },
  { value: "skill", label: "Skill" },
  { value: "tool", label: "Tool" },
  { value: "human-gate", label: "Human gate" },
  { value: "workflow", label: "Workflow" },
  { value: "output", label: "Output" },
];

function stepKindLabel(kind: WorkflowStepKind): string {
  return STEP_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

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

// The standard CWF-01 on-error dispositions. A blank value means "inherit the
// workflow default"; an unrecognized manifest value is preserved as a fallback
// option so editing never silently drops it.
const ON_ERROR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  { value: "retry", label: "Retry" },
  { value: "halt", label: "Halt" },
  { value: "escalate", label: "Escalate" },
];

function issuesForAction(action: WorkflowStudioActionState | null): WorkflowValidationIssue[] {
  if (!action?.result || !("issues" in action.result)) return [];
  return action.result.issues ?? [];
}

/** The dry-run preflight estimate (what the run will cost / need), if the current action carries one. */
function estimatesForAction(action: WorkflowStudioActionState | null): WorkflowDryRunPlan["estimates"] | null {
  if (action?.kind !== "dry-run") return null;
  return (action.result as WorkflowDryRunPlan).estimates ?? null;
}

/** Flatten the dry-run estimate into the present (label, value) rows worth showing. */
function preflightRows(estimates: NonNullable<WorkflowDryRunPlan["estimates"]>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (typeof estimates.maxAgents === "number") rows.push({ label: "Agents", value: String(estimates.maxAgents) });
  if (typeof estimates.timeoutS === "number") rows.push({ label: "Timeout", value: `${estimates.timeoutS}s` });
  if (typeof estimates.costCeilingUsd === "number") {
    rows.push({ label: "Cost ceiling", value: `$${estimates.costCeilingUsd}` });
  }
  if (estimates.requiredCapabilities?.length) {
    rows.push({ label: "Capabilities", value: estimates.requiredCapabilities.join(", ") });
  }
  if (estimates.requiredExternalAccounts?.length) {
    rows.push({ label: "External accounts", value: estimates.requiredExternalAccounts.join(", ") });
  }
  if (estimates.humanGates?.length) {
    rows.push({ label: "Human gates", value: String(estimates.humanGates.length) });
  }
  return rows;
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
  suggestions,
  listId,
  multiline,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
  /** Optional autocomplete candidates rendered as a native <datalist>. */
  suggestions?: WorkflowUsesOption[];
  listId?: string;
  /** Render a textarea (for prose like summaries that feed the run prompt). */
  multiline?: boolean;
}) {
  const hasSuggestions = Boolean(listId && suggestions && suggestions.length > 0);
  if (multiline) {
    return (
      <label className="workflow-field">
        <span>{label}</span>
        <textarea
          className="workflow-field-textarea"
          rows={2}
          defaultValue={value}
          placeholder={placeholder}
          key={`${label}:${value}`}
          onBlur={(event) => {
            if (event.target.value !== value) onCommit(event.target.value);
          }}
        />
      </label>
    );
  }
  return (
    <label className="workflow-field">
      <span>{label}</span>
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        list={hasSuggestions ? listId : undefined}
        key={`${label}:${value}`}
        onBlur={(event) => {
          if (event.target.value !== value) onCommit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
      {hasSuggestions && (
        <datalist id={listId}>
          {suggestions!.map((option) => (
            <option key={`${option.group}:${option.value}`} value={option.value}>
              {option.group}
            </option>
          ))}
        </datalist>
      )}
    </label>
  );
}

/** Step editor when a node is selected; workflow meta editor otherwise. */
export function WorkflowInspector({
  workflow,
  selectedNode,
  action,
  usesOptions,
  onUpdateStep,
  onUpdateMeta,
  onRemoveStep,
  onSelectStep,
  onConnect,
  onDisconnect,
}: WorkflowInspectorProps) {
  const issues = issuesForAction(action);
  const step = selectedNode
    ? workflow?.steps?.find((entry) => entry.id === selectedNode.id) ?? null
    : null;

  // Run readiness reads the input → steps → output contract the runner enforces
  // (workflowRunBlockReason). Surfacing it here — where the workflow is built —
  // makes the execution contract legible without hovering the disabled Play
  // button. The counts split the graph into its declared input(s), the work
  // between, and the produced output(s).
  const estimates = estimatesForAction(action);
  const preflight = estimates ? preflightRows(estimates) : [];
  const runBlock = workflowRunBlockReason(workflow);
  const inputCount = workflow ? workflowInputSteps(workflow).length : 0;
  const outputCount = workflow ? workflowOutputSteps(workflow).length : 0;
  const middleCount = Math.max(0, (workflow?.steps?.length ?? 0) - inputCount - outputCount);
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  return (
    <section className="workflow-panel workflow-inspector" aria-label="Workflow inspector">
      <div className="workflow-panel-heading">
        <div className="workflow-heading-lead">
          <div>
            <p className="workflow-eyebrow">{step ? `Selected node · ${stepKindLabel(step.kind)}` : "Workflow"}</p>
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
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
              {!STEP_KINDS.some((entry) => entry.value === step.kind) && (
                <option value={step.kind}>{step.kind}</option>
              )}
            </select>
          </label>
          <Field
            label="Uses"
            value={step.uses ?? ""}
            placeholder="nova · cwf-validator@^1.0.0 · cave.output"
            suggestions={usesOptions}
            listId="workflow-uses-options"
            onCommit={(next) => onUpdateStep(step.id, { uses: next || undefined })}
          />
          <Field
            label="Summary"
            value={step.summary ?? ""}
            multiline
            onCommit={(next) => onUpdateStep(step.id, { summary: next || undefined })}
          />
          <Field
            label="Permissions"
            value={(step.permissions ?? []).join(", ")}
            placeholder="repo.read, web.fetch"
            onCommit={(next) => onUpdateStep(step.id, { permissions: parseCsv(next) })}
          />
          <label className="workflow-field">
            <span>On error</span>
            <select
              value={step.on_error ?? ""}
              onChange={(event) => onUpdateStep(step.id, { on_error: event.target.value || undefined })}
            >
              {ON_ERROR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {step.on_error && !ON_ERROR_OPTIONS.some((option) => option.value === step.on_error) && (
                <option value={step.on_error}>{step.on_error}</option>
              )}
            </select>
          </label>
          {(() => {
            // Dependency editor — the canvas-free way to wire `requires`, so a
            // step's prerequisites are editable on mobile (where the React Flow
            // canvas is swapped for the linear step list) as well as on desktop.
            // Toggling a chip draws/removes the same edge the canvas would:
            // making this step require another is connect(other → this). Options
            // that would close a cycle are disabled (the reducer rejects them
            // anyway; disabling makes that legible instead of a silent no-op).
            const steps = workflow?.steps ?? [];
            const others = steps.filter((entry) => entry.id !== step.id);
            return (
              <div className="workflow-field workflow-requires-field">
                <span>Requires</span>
                {others.length === 0 ? (
                  <p className="workflow-muted workflow-requires-empty">No other steps to depend on yet.</p>
                ) : (
                  <div className="workflow-requires-options" role="group" aria-label="Step dependencies">
                    {others.map((other) => {
                      const active = step.requires?.includes(other.id) ?? false;
                      const cyclic = !active && wouldCreateCycle(steps, other.id, step.id);
                      const label = other.name ?? other.id;
                      return (
                        <button
                          key={other.id}
                          type="button"
                          className={`workflow-requires-chip${active ? " is-active" : ""}`}
                          aria-pressed={active}
                          disabled={cyclic || (!onConnect && !onDisconnect)}
                          title={
                            cyclic
                              ? `Requiring ${label} would create a dependency cycle`
                              : active
                                ? `Stop requiring ${label}`
                                : `Require ${label} to finish first`
                          }
                          onClick={() =>
                            active
                              ? onDisconnect?.(other.id, step.id)
                              : onConnect?.(other.id, step.id)
                          }
                        >
                          {active && <Icon name="ph:check-bold" width={10} aria-hidden />}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="workflow-muted workflow-requires-hint">
                  Pick the steps that must finish first. On desktop you can also draw edges on the canvas.
                </p>
              </div>
            );
          })()}
        </div>
      ) : workflow ? (
        <div className="workflow-editor">
          <div
            className={`workflow-run-readiness${runBlock ? " is-blocked" : " is-ready"}`}
            role="status"
          >
            <Icon name={runBlock ? "ph:warning-circle" : "ph:check-circle-bold"} width={14} />
            <div className="workflow-run-readiness-text">
              <span className="workflow-run-readiness-label">
                {runBlock ? "Not runnable yet" : "Ready to run"}
              </span>
              <span className="workflow-run-readiness-contract">
                {runBlock ?? (
                  <>
                    {count(inputCount, "input")}
                    <Icon name="ph:arrow-right-bold" width={11} aria-hidden />
                    {count(middleCount, "step")}
                    <Icon name="ph:arrow-right-bold" width={11} aria-hidden />
                    {count(outputCount, "output")}
                  </>
                )}
              </span>
            </div>
          </div>
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
            multiline
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
          {issues.slice(0, 6).map((issue, index) => {
            const targetStep = onSelectStep ? stepIdForIssue(issue, workflow?.steps ?? []) : null;
            const body = (
              <>
                <span className={`workflow-issue-tier workflow-issue-${issue.tier}`}>{issue.tier}</span>
                <span>
                  {issue.message ?? issue.code}
                  {issue.suggestion ? ` — ${issue.suggestion}` : ""}
                </span>
              </>
            );
            return (
              <li key={`${issue.code}:${issue.path ?? index}`}>
                {targetStep ? (
                  <button
                    type="button"
                    className="workflow-issue-jump"
                    onClick={() => onSelectStep!(targetStep)}
                    title={`Go to step ${targetStep}`}
                  >
                    {body}
                    <Icon name="ph:arrow-right-bold" width={10} aria-hidden className="workflow-issue-jump-icon" />
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}

      {preflight.length > 0 && (
        <>
          <h3>Preflight</h3>
          <p className="workflow-muted workflow-preflight-lead">What a run would need, from the dry-run plan.</p>
          <dl className="workflow-detail-list workflow-preflight-list">
            {preflight.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      </>
    </section>
  );
}
