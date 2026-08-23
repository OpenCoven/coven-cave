"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  actOnResearchMission,
  getResearchMission,
} from "@/lib/research-mission-client";
import {
  researchMissionToRunSurface,
  type ResearchRunStep,
  type ResearchRunSurfaceModel,
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

type InlineProps = {
  snapshot: ResearchRunSurfaceModel;
  onOpenDesk?(): void;
};

const LIVE = new Set<ResearchRunSurfaceModel["status"]>([
  "planning",
  "queued",
  "running",
]);

const POLLABLE = new Set<ResearchRunSurfaceModel["status"]>([
  "planning",
  "queued",
  "running",
  "awaiting_input",
  "awaiting_authority",
  "paused",
]);

function stepIcon(step: ResearchRunStep) {
  if (step.status === "completed") return "ph:check" as const;
  if (step.status === "failed") return "ph:x" as const;
  if (step.status === "blocked") return "ph:lock-simple" as const;
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
  if (run.evidence.sources !== undefined) values.push(`${run.evidence.sources} sources`);
  if (run.evidence.reviewed !== undefined) values.push(`${run.evidence.reviewed} reviewed`);
  if (run.evidence.retained !== undefined) values.push(`${run.evidence.retained} retained`);
  if (run.evidence.cited !== undefined) values.push(`${run.evidence.cited} cited`);
  if (run.evidence.artifacts !== undefined) values.push(`${run.evidence.artifacts} artifacts`);
  return values;
}

/**
 * Chat projection for a durable research run. The marker embedded in the
 * assistant turn is only an initial snapshot and a stable run identifier; this
 * component immediately rehydrates from the canonical Research mission API and
 * keeps polling while the run can still change. That prevents chat from owning
 * a second research state machine and lets a card survive navigation/reload as
 * a view of the same run the Research Desk displays.
 */
export function ResearchRunInlineCard({ snapshot, onOpenDesk }: InlineProps) {
  const [run, setRun] = useState(snapshot);
  const [canonical, setCanonical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const canonicalRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    canonicalRef.current = false;
    setCanonical(false);
    setRun(snapshot);
    setActionError(null);
    return () => {
      mounted.current = false;
    };
  }, [snapshot.runId]);

  // Repeated markers can refine a provider-only run while it streams. Accept
  // those snapshots until the canonical mission API has answered once; after
  // that, server state owns the projection and stale marker text cannot regress
  // it on unrelated parent renders.
  useEffect(() => {
    if (!canonicalRef.current) setRun(snapshot);
  }, [snapshot]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let stopped = false;

    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await getResearchMission(snapshot.runId, controller.signal);
        if (stopped) return;
        if (!result.ok || !result.mission) {
          // A provider-only snapshot may not have a local mission yet. Keep the
          // truthful persisted snapshot visible and retry while it can change.
          if (POLLABLE.has(snapshot.status)) timer = setTimeout(refresh, 5_000);
          return;
        }
        canonicalRef.current = true;
        setCanonical(true);
        const next = researchMissionToRunSurface(result.mission);
        setRun(next);
        if (POLLABLE.has(next.status)) {
          timer = setTimeout(refresh, 2_000);
        }
      } catch (error) {
        if (stopped || (error as Error).name === "AbortError") return;
        // Transport loss is not evidence the run stopped. Keep the last
        // durable/snapshot projection and retry instead of freezing the card.
        timer = setTimeout(refresh, 5_000);
      }
    };

    void refresh();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [snapshot.runId, snapshot.status]);

  const act = useCallback(async (action: "pause" | "resume" | "cancel") => {
    if (busy || !canonical) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await actOnResearchMission(run.runId, { action });
      if (!mounted.current) return;
      if (!result.ok || !result.mission) {
        setActionError(result.error ?? "Research action failed");
        return;
      }
      setRun(researchMissionToRunSurface(result.mission));
    } catch {
      if (mounted.current) setActionError("Research action failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, canonical, run.runId]);

  const canControl = canonical && !busy;
  return (
    <div>
      <ResearchRunSurface
        run={run}
        variant="inline"
        onOpenDesk={onOpenDesk}
        onPause={canControl ? () => void act("pause") : undefined}
        onResume={canControl ? () => void act("resume") : undefined}
        onStop={canControl ? () => void act("cancel") : undefined}
      />
      {actionError ? (
        <p className="mt-1 text-[length:var(--text-2xs)] text-[var(--text-danger)]" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
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
                          ? "border-[var(--text-danger)] text-[var(--text-danger)]"
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
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]"
            role="progressbar"
            aria-label="Research progress"
            aria-valuetext="Research is active; progress is not yet measurable"
          >
            <div className="h-full w-1/4 animate-pulse rounded-full bg-[var(--fg-primary)] motion-reduce:animate-none" aria-hidden />
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
