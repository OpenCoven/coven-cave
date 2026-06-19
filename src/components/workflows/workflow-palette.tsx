"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { WorkflowStepKind, WorkflowSummary } from "@/lib/workflows";

type WorkflowPaletteProps = {
  workflow: WorkflowSummary | null;
  onAddStep: (kind: WorkflowStepKind) => void;
};

const PALETTE: Array<{ kind: WorkflowStepKind; label: string; icon: IconName; tone: string }> = [
  { kind: "input", label: "Input", icon: "ph:tray", tone: "input" },
  { kind: "agent", label: "Agent", icon: "ph:brain", tone: "agent" },
  { kind: "skill", label: "Skill", icon: "ph:sparkle", tone: "tool" },
  { kind: "tool", label: "Tool", icon: "ph:wrench", tone: "tool" },
  { kind: "human-gate", label: "Human gate", icon: "ph:hand", tone: "gate" },
  { kind: "workflow", label: "Workflow", icon: "ph:graph", tone: "workflow" },
  { kind: "output", label: "Output", icon: "ph:package-bold", tone: "output" },
];

/** Node palette: one click appends a step of the given CWF-01 kind. */
export function WorkflowPalette({ workflow, onAddStep }: WorkflowPaletteProps) {
  return (
    <div className="workflow-palette" role="toolbar" aria-label="Add step">
      {PALETTE.map((entry) => (
        <button
          key={entry.kind}
          type="button"
          className={`workflow-palette-item workflow-palette-${entry.tone}`}
          disabled={!workflow}
          onClick={() => onAddStep(entry.kind)}
          title={workflow ? `Add ${entry.label.toLowerCase()} step` : "Select a workflow first"}
        >
          <Icon name={entry.icon} width={13} />
          {entry.label}
        </button>
      ))}
    </div>
  );
}
