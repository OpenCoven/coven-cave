"use client";

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { slugifyWorkflowId } from "@/lib/workflow-edit";
import type {
  WorkflowPattern,
  WorkflowScheduleRecurrence,
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
  onClose: () => void;
  onCreate: (input: { name: string; pattern: WorkflowPattern; familiar?: string }) => void;
};

/** New-workflow dialog: name + CWF-01 pattern template + optional familiar. */
export function WorkflowCreateDialog({ onClose, onCreate }: WorkflowCreateDialogProps) {
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState<WorkflowPattern>("sequential");
  const [familiar, setFamiliar] = useState("");
  const id = slugifyWorkflowId(name);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Trap Tab/Shift+Tab inside the modal and close on Escape. focusFirst is off
  // so the Name input's autoFocus keeps the initial focus.
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

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
            <h2>Create from pattern</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>
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
            value={familiar}
            placeholder="nova"
            onChange={(event) => setFamiliar(event.target.value)}
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
            onClick={() => onCreate({ name, pattern, familiar: familiar || undefined })}
          >
            <Icon name="ph:plus-bold" width={13} />
            Create workflow
          </button>
        </div>
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
