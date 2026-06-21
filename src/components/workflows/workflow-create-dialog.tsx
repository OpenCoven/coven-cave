"use client";

import { useMemo, useRef, useState } from "react";
import { parse as parseYaml } from "yaml";
import { Icon } from "@/lib/icon";
import { Tabs } from "@/components/ui/tabs";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { slugifyWorkflowId } from "@/lib/workflow-edit";
import {
  generateWorkflowManifest,
  generateWorkflowQuestions,
  type GeneratedAnswer,
  type GeneratedQuestion,
} from "@/lib/workflow-generate";
import type { WorkflowFamiliarOption } from "@/components/workflows/workflow-attachments";
import type {
  WorkflowPattern,
  WorkflowScheduleRecurrence,
  WorkflowStepSummary,
  WorkflowSummary,
} from "@/lib/workflows";

const PATTERNS: Array<{ id: WorkflowPattern; hint: string }> = [
  { id: "sequential", hint: "plan → execute → review" },
  { id: "fan-out-and-synthesize", hint: "parallel workers → merge" },
  { id: "classify-and-act", hint: "label → route-specific action" },
  { id: "adversarial-verification", hint: "propose → refute → verdict" },
  { id: "generate-and-filter", hint: "wide pool → keep the best" },
  { id: "tournament", hint: "seed → rounds → champion" },
  { id: "loop-until-done", hint: "attempt → check → repeat" },
  { id: "custom", hint: "start from a blank pair" },
];

type WorkflowCreateDialogProps = {
  familiarOptions: WorkflowFamiliarOption[];
  onClose: () => void;
  onCreate: (input: { name: string; pattern: WorkflowPattern; familiar?: string }) => void;
  onCreateManifest: (manifest: Record<string, unknown>) => void;
};

type CreateMode = "describe" | "pattern";
type DescribeStep = "describe" | "questions" | "review";

/** Lightweight read of a parsed manifest object for the review summary. */
function reviewSummary(manifest: Record<string, unknown>): {
  pattern: string;
  familiar: string | null;
  steps: Array<{ id: string; kind: string; name?: string }>;
} {
  const rawSteps = Array.isArray(manifest.steps) ? manifest.steps : [];
  const steps = rawSteps.map((step) => {
    const s = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
    return {
      id: typeof s.id === "string" ? s.id : "?",
      kind: typeof s.kind === "string" ? s.kind : "?",
      name: typeof s.name === "string" ? s.name : undefined,
    };
  });
  return {
    pattern: typeof manifest.pattern === "string" ? manifest.pattern : "custom",
    familiar: typeof manifest.familiar === "string" ? manifest.familiar : null,
    steps,
  };
}

/**
 * New-workflow dialog. Two modes:
 *  - "describe" (default): the picked familiar asks 2-3 clarifying questions, then
 *    generates a full manifest the user reviews before creating.
 *  - "pattern": the original name + CWF-01 template + optional familiar form.
 */
export function WorkflowCreateDialog({ familiarOptions, onClose, onCreate, onCreateManifest }: WorkflowCreateDialogProps) {
  const [mode, setMode] = useState<CreateMode>("describe");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  // Shared name field (used by both modes).
  const [name, setName] = useState("");
  const id = slugifyWorkflowId(name);

  // Pattern-mode state.
  const [pattern, setPattern] = useState<WorkflowPattern>("sequential");
  const [patternFamiliar, setPatternFamiliar] = useState("");

  // Describe-mode state.
  const [step, setStep] = useState<DescribeStep>("describe");
  const [goal, setGoal] = useState("");
  const [familiarId, setFamiliarId] = useState("");
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const familiarName = useMemo(
    () => familiarOptions.find((option) => option.id === familiarId)?.label ?? familiarId,
    [familiarId, familiarOptions],
  );

  const runQuestions = async () => {
    setBusy(true);
    setGenError(null);
    const result = await generateWorkflowQuestions({ goal, familiarId });
    setBusy(false);
    if (!result.questions) {
      setGenError(result.error ?? "couldn't get questions — try again");
      return;
    }
    setQuestions(result.questions);
    setStep("questions");
  };

  const runManifest = async () => {
    setBusy(true);
    setGenError(null);
    const payload: GeneratedAnswer[] = questions.map((question) => ({
      id: question.id,
      question: question.question,
      answer: answers[question.id]?.trim() ?? "",
    }));
    const result = await generateWorkflowManifest({
      goal,
      answers: payload,
      familiarId,
      suggestedName: name.trim() || undefined,
    });
    setBusy(false);
    if (!result.manifest) {
      setGenError(result.error ?? "couldn't build the workflow — regenerate");
      return;
    }
    setManifest(result.manifest);
    setStep("review");
  };

  const describeDisabled = busy || familiarId.trim().length === 0 || goal.trim().length === 0;

  return (
    <div className="workflow-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New workflow"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-panel-heading">
          <div>
            <p className="workflow-eyebrow">New workflow</p>
            <h2>{mode === "describe" ? "Describe it — your familiar builds it" : "Create from pattern"}</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>

        <Tabs
          variant="segment"
          size="sm"
          ariaLabel="Create mode"
          value={mode}
          onChange={setMode}
          items={[
            { id: "describe", label: "Describe", icon: "ph:sparkle" },
            { id: "pattern", label: "Pattern" },
          ]}
        />

        {mode === "pattern" ? (
          <>
            <label className="workflow-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                autoFocus
                placeholder="Nightly release review"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="workflow-muted">Saved as workflows/{id}.yaml</p>
            <div className="workflow-pattern-grid" role="radiogroup" aria-label="Pattern">
              {PATTERNS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={pattern === entry.id}
                  className={`workflow-pattern-option${pattern === entry.id ? " is-active" : ""}`}
                  onClick={() => setPattern(entry.id)}
                >
                  <span className="workflow-pattern-name">{entry.id}</span>
                  <span className="workflow-pattern-hint">{entry.hint}</span>
                </button>
              ))}
            </div>
            <label className="workflow-field">
              <span>Familiar (optional)</span>
              <input
                type="text"
                value={patternFamiliar}
                placeholder="nova"
                onChange={(event) => setPatternFamiliar(event.target.value)}
              />
            </label>
            <div className="workflow-dialog-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="workflow-primary-button"
                disabled={name.trim().length === 0}
                onClick={() => onCreate({ name, pattern, familiar: patternFamiliar || undefined })}
              >
                <Icon name="ph:plus-bold" width={13} />
                Create workflow
              </button>
            </div>
          </>
        ) : step === "describe" ? (
          <>
            <label className="workflow-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                autoFocus
                placeholder="Triage inbound bugs"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="workflow-field">
              <span>Familiar</span>
              <select value={familiarId} onChange={(event) => setFamiliarId(event.target.value)}>
                <option value="">Choose a familiar…</option>
                {familiarOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="workflow-field">
              <span>What should this workflow do?</span>
              <textarea
                className="workflow-run-input-field"
                rows={4}
                placeholder="Describe the goal in your own words…"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            {genError && <p className="workflow-import-error">{genError}</p>}
            <div className="workflow-dialog-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="workflow-primary-button" disabled={describeDisabled} onClick={() => void runQuestions()}>
                {busy ? <Icon name="ph:circle-notch-bold" width={13} className="workflow-spin" /> : <Icon name="ph:sparkle" width={13} />}
                {busy ? "Thinking…" : "Continue"}
              </button>
            </div>
          </>
        ) : step === "questions" ? (
          <>
            <p className="workflow-muted">{familiarName} wants to know a few things:</p>
            <div className="workflow-run-inputs-list">
              {questions.map((question, index) => (
                <label className="workflow-field" key={question.id}>
                  <span>{question.question}</span>
                  {question.hint && <span className="workflow-run-input-hint">{question.hint}</span>}
                  <textarea
                    className="workflow-run-input-field"
                    rows={2}
                    autoFocus={index === 0}
                    placeholder="Your answer…"
                    value={answers[question.id] ?? ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            {genError && <p className="workflow-import-error">{genError}</p>}
            <div className="workflow-dialog-actions">
              <button type="button" onClick={() => { setGenError(null); setStep("describe"); }}>
                Back
              </button>
              <button type="button" className="workflow-primary-button" disabled={busy} onClick={() => void runManifest()}>
                {busy ? <Icon name="ph:circle-notch-bold" width={13} className="workflow-spin" /> : <Icon name="ph:sparkle" width={13} />}
                {busy ? "Building…" : "Generate workflow"}
              </button>
            </div>
          </>
        ) : (
          (() => {
            const summary = manifest ? reviewSummary(manifest) : null;
            return (
              <>
                <p className="workflow-muted">
                  {summary
                    ? `Proposed: pattern ${summary.pattern} · ${summary.steps.length} steps${summary.familiar ? ` · familiar ${summary.familiar}` : ""}`
                    : "No workflow generated."}
                </p>
                {summary && (
                  <ol className="workflow-review-steps">
                    {summary.steps.map((s) => (
                      <li key={s.id} className="workflow-review-step">
                        <span className={`workflow-review-kind workflow-review-kind--${s.kind}`}>{s.kind}</span>
                        <span className="workflow-review-name">{s.name ?? s.id}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {genError && <p className="workflow-import-error">{genError}</p>}
                <div className="workflow-dialog-actions">
                  <button type="button" onClick={() => { setGenError(null); setStep("questions"); }}>
                    Back
                  </button>
                  <button type="button" disabled={busy} onClick={() => void runManifest()}>
                    {busy ? "Regenerating…" : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    className="workflow-primary-button"
                    disabled={!manifest}
                    onClick={() => manifest && onCreateManifest(manifest)}
                  >
                    <Icon name="ph:plus-bold" width={13} />
                    Create & open
                  </button>
                </div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

type WorkflowScheduleDialogProps = {
  workflow: WorkflowSummary;
  onClose: () => void;
  onSchedule: (fireAt: string, recurrence: WorkflowScheduleRecurrence) => void;
};

type Cadence = "once" | "daily" | "weekly" | "interval";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function defaultFireAt(): string {
  // datetime-local value for one hour from now, minute precision.
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

type WorkflowRunInputsDialogProps = {
  workflow: WorkflowSummary;
  /** The workflow's declared `input` steps — one capture field per node. */
  inputSteps: WorkflowStepSummary[];
  onClose: () => void;
  onRun: (inputs: Record<string, string>) => void;
};

/** The label a captured value is keyed by in the run prompt (name wins over id). */
function inputKey(step: WorkflowStepSummary): string {
  return step.name?.trim() || step.id;
}

/**
 * Capture the value(s) for a workflow's declared input node(s) before running.
 * A runnable workflow always has at least one `input` node (the run gate
 * requires it), so this is the moment its input is actually supplied — the
 * compiled run prompt carries these values instead of asking the agent to chase
 * them down. Every field is optional: leaving one blank falls back to the
 * prompt's existing "ask for the missing value" behaviour, so this never blocks
 * a quick run.
 */
export function WorkflowRunInputsDialog({ workflow, inputSteps, onClose, onRun }: WorkflowRunInputsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const filledCount = useMemo(
    () => Object.values(values).filter((value) => value.trim().length > 0).length,
    [values],
  );

  const submit = () => {
    const inputs: Record<string, string> = {};
    for (const step of inputSteps) {
      const value = values[step.id]?.trim();
      if (value) inputs[inputKey(step)] = value;
    }
    onRun(inputs);
  };

  return (
    <div className="workflow-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Run inputs"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-panel-heading">
          <div>
            <p className="workflow-eyebrow">Run inputs</p>
            <h2>{workflow.name ?? workflow.id}</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>
        <p className="workflow-muted">
          Supply the value for each input node. Anything left blank, the agent will ask for as it runs.
        </p>
        <div className="workflow-run-inputs-list">
          {inputSteps.map((step, index) => (
            <label className="workflow-field" key={step.id}>
              <span>{step.name?.trim() || step.id}</span>
              {step.summary?.trim() && (
                <span className="workflow-run-input-hint">{step.summary.trim()}</span>
              )}
              <textarea
                className="workflow-run-input-field"
                rows={2}
                autoFocus={index === 0}
                placeholder="Value for this input…"
                value={values[step.id] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [step.id]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <div className="workflow-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="workflow-play-button workflow-primary-button" onClick={submit}>
            <Icon name="ph:lightning-bold" width={13} />
            {filledCount > 0 ? `Run with ${filledCount} input${filledCount === 1 ? "" : "s"}` : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

type WorkflowImportDialogProps = {
  onClose: () => void;
  onImport: (manifest: Record<string, unknown>) => void;
};

/**
 * Import a workflow by pasting its manifest (YAML or JSON — `yaml.parse` reads
 * both). The round-trip partner to the manifest Copy button: copy a manifest
 * from one workflow, paste it here to recreate it. Schema validation happens on
 * Save; this dialog only guards that the paste is a single manifest object.
 */
export function WorkflowImportDialog({ onClose, onImport }: WorkflowImportDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const submit = () => {
    if (!text.trim()) {
      setError("Paste a workflow manifest first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't parse the manifest.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("A manifest must be a single YAML/JSON object.");
      return;
    }
    onImport(parsed as Record<string, unknown>);
  };

  return (
    <div className="workflow-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Import workflow"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-panel-heading">
          <div>
            <p className="workflow-eyebrow">Import workflow</p>
            <h2>Paste a manifest</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>
        <p className="workflow-muted">YAML or JSON. Imported as a personal copy; the id is de-duplicated if it collides.</p>
        <textarea
          className="workflow-run-input-field workflow-import-field"
          rows={10}
          autoFocus
          placeholder={"id: my-workflow\nversion: 0.1.0\nsteps:\n  - id: input\n    kind: input\n  - id: output\n    kind: output"}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
        />
        {error && <p className="workflow-import-error">{error}</p>}
        <div className="workflow-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="workflow-primary-button" disabled={text.trim().length === 0} onClick={submit}>
            <Icon name="ph:clipboard-text" width={13} />
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Schedule-as-automation: creates a real inbox reminder linking back to the
 * workflow. Deliberately not an execution schedule — the daemon has no
 * workflow engine yet.
 */
export function WorkflowScheduleDialog({ workflow, onClose, onSchedule }: WorkflowScheduleDialogProps) {
  const [fireAtLocal, setFireAtLocal] = useState(defaultFireAt);
  const [cadence, setCadence] = useState<Cadence>("once");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [intervalHours, setIntervalHours] = useState(24);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Trap Tab/Shift+Tab inside the modal and close on Escape. focusFirst is off
  // so the "First reminder" input's autoFocus keeps the initial focus.
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const submit = () => {
    const fireDate = new Date(fireAtLocal);
    if (Number.isNaN(fireDate.getTime())) return;
    const fireAt = fireDate.toISOString();
    const hour = fireDate.getHours();
    const minute = fireDate.getMinutes();
    const recurrence: WorkflowScheduleRecurrence =
      cadence === "daily"
        ? { type: "daily", hour, minute }
        : cadence === "weekly"
          ? { type: "weekly", days, hour, minute }
          : cadence === "interval"
            ? { type: "interval", everyMs: Math.max(1, intervalHours) * 60 * 60 * 1000 }
            : { type: "none" };
    onSchedule(fireAt, recurrence);
  };

  return (
    <div className="workflow-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Schedule workflow"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-panel-heading">
          <div>
            <p className="workflow-eyebrow">Schedule</p>
            <h2>{workflow.name ?? workflow.id}</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>
        <label className="workflow-field">
          <span>First reminder</span>
          <input
            type="datetime-local"
            value={fireAtLocal}
            autoFocus
            onChange={(event) => setFireAtLocal(event.target.value)}
          />
        </label>
        <label className="workflow-field">
          <span>Repeat</span>
          <select value={cadence} onChange={(event) => setCadence(event.target.value as Cadence)}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="interval">Every N hours</option>
          </select>
        </label>
        {cadence === "weekly" && (
          <div className="workflow-weekday-row" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`workflow-weekday${days.includes(index) ? " is-active" : ""}`}
                aria-pressed={days.includes(index)}
                onClick={() =>
                  setDays((current) =>
                    current.includes(index)
                      ? current.filter((day) => day !== index)
                      : [...current, index].sort(),
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {cadence === "interval" && (
          <label className="workflow-field">
            <span>Hours between reminders</span>
            <input
              type="number"
              min={1}
              max={720}
              value={intervalHours}
              onChange={(event) => setIntervalHours(Number(event.target.value) || 1)}
            />
          </label>
        )}
        <p className="workflow-muted">
          Creates a reminder on the Schedules surface that links back to this workflow. Execution
          scheduling arrives with the daemon engine.
        </p>
        <div className="workflow-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="workflow-primary-button"
            disabled={cadence === "weekly" && days.length === 0}
            onClick={submit}
          >
            <Icon name="ph:clock-countdown" width={13} />
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
