"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type {
  ResearchRunStep,
  ResearchRunSurfaceModel,
} from "@/lib/research-run-surface";

export type ResearchRunSurfaceVariant = "inline" | "workspace" | "completed";

type Props = {
  run: ResearchRunSurfaceModel;
  variant?: ResearchRunSurfaceVariant;
  onOpenDesk?(): void;
  onPause?(): void;
  onResume?(): void;
  onStop?(): void;
};

const LIVE = new Set<ResearchRunSurfaceModel["status"]>([
  "planning",
  "queued",
  "running",
]);

function stepIcon(step: ResearchRunStep) {
  if (step.status === "completed") return "ph:check" as const;
  if (step.status === "failed") return "ph:x" as const;
  if (step.status === "blocked") return "ph:lock" as const;
  if (step.status === "skipped") return "ph:minus" as const;
  return null;
}

function statusLabel(status: ResearchRunSurfaceModel["status"]): string {
  if (status === "awaiting_input") return "Needs input";
  if (status === "awaiting_authority") return "Authority required";
  if (status === "partial") return "Completed with limitations";
  return status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function evidenceSummary(run: ResearchRunSurfaceModel): string[] {
  const values: string[] = [];
  if (run.evidence.reviewed !== undefined) values.push(`${run.evidence.reviewed} reviewed`);
  if (run.evidence.retained !== undefined) values.push(`${run.evidence.retained} retained`);
  if (run.evidence.cited !== undefined) values.push(`${run.evidence.cited} cited`);
  if (run.evidence.artifacts !== undefined) values.push(`${run.evidence.artifacts} artifacts`);
  return values;
}

export function ResearchRunSurface({
  run,
  variant = "inline",
  onOpenDesk,
  onPause,
  onResume,
  onStop,
}: Props) {
  const completed = run.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
  const active = run.steps.find((step) => step.status === "active");
  const evidence = evidenceSummary(run);
  const live = LIVE.has(run.status);
  const compact = variant === "inline";

  return (
    <section
      className={[
        "rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-elevated)]",
        compact ? "p-4" : "p-5",
      ].join(" ")}
      aria-label={`Research run: ${run.title}`}
      data-research-run-id={run.runId}
      data-research-run-status={run.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[length:var(--text-sm)] font-semibold text-[var(--fg-primary)]">
            {run.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-2xs)] text-[var(--fg-muted)]">
            {run.familiarId ? <span>{run.familiarId}</span> : null}
            {run.skill ? <span>{run.skill}</span> : null}
            {run.runtime ? <span>{run.runtime}</span> : null}
            <span role="status">{statusLabel(run.status)}</span>
          </div>
        </div>
        {onOpenDesk ? (
          <Button size="xs" variant="ghost" onClick={onOpenDesk}>
            Open in Research Desk
          </Button>
        ) : null}
      </header>

      {run.steps.length > 0 ? (
        <ol className="mt-4 space-y-2" aria-label="Research plan">
          {run.steps.map((step) => {
            const icon = stepIcon(step);
            return (
              <li
                key={step.id}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-[length:var(--text-sm)]"
                data-step-status={step.status}
              >
                <span
                  className={[
                    "mt-0.5 grid h-5 w-5 place-items-center rounded-full border",
                    step.status === "active"
                      ? "border-[var(--fg-primary)] text-[var(--fg-primary)]"
                      : step.status === "completed"
                        ? "border-[var(--fg-primary)] bg-[var(--fg-primary)] text-[var(--bg-base)]"
                        : step.status === "failed" || step.status === "blocked"
                          ? "border-[var(--danger)] text-[var(--danger)]"
                          : "border-dashed border-[var(--border-strong)] text-[var(--fg-muted)]",
                  ].join(" ")}
                  aria-hidden
                >
                  {icon ? <Icon name={icon} width={11} height={11} aria-hidden /> : null}
                </span>
                <span className={step.status === "pending" ? "text-[var(--fg-secondary)]" : "text-[var(--fg-primary)]"}>
                  <span>{step.label}</span>
                  {step.detail ? (
                    <span className="mt-0.5 block text-[length:var(--text-xs)] text-[var(--fg-muted)]">
                      {step.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-xs)] text-[var(--fg-secondary)]" aria-live="polite">
              {run.activity || active?.detail || (live ? "Research is in progress…" : statusLabel(run.status))}
            </p>
            {run.steps.length > 0 ? (
              <p className="mt-1 text-[length:var(--text-2xs)] text-[var(--fg-muted)]">
                {completed} of {run.steps.length} stages complete
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {run.status === "paused" && onResume ? (
              <Button size="xs" variant="ghost" onClick={onResume}>Resume</Button>
            ) : live && onPause ? (
              <Button size="xs" variant="ghost" onClick={onPause}>Pause</Button>
            ) : null}
            {(live || run.status === "paused" || run.status === "awaiting_input" || run.status === "awaiting_authority") && onStop ? (
              <Button size="xs" variant="danger-ghost" onClick={onStop}>Stop</Button>
            ) : null}
          </div>
        </div>

        {live ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]" aria-hidden>
            <div className="h-full w-1/4 animate-pulse rounded-full bg-[var(--fg-primary)]" />
          </div>
        ) : null}

        {evidence.length > 0 ? (
          <p className="mt-2 text-[length:var(--text-2xs)] text-[var(--fg-muted)]">
            {evidence.join(" · ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
