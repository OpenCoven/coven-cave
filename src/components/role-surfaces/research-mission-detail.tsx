"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import {
  allowedResearchActions,
  type ResearchMission,
  type ResearchMissionAction,
  type ResearchMissionActionInput,
} from "@/lib/research-missions";
import { ResearchEvidenceLedger } from "./research-evidence-ledger";

type Props = {
  mission: ResearchMission | null;
  onOpenSession(sessionId: string): void;
  onOpenUrl(url: string): void;
  onAction(input: ResearchMissionActionInput): Promise<{ ok: boolean; error?: string }>;
  onSchedule(rrule: string): Promise<{ ok: boolean; error?: string }>;
  onAutomationAction(
    automationId: string,
    action: "pause" | "resume" | "run-now",
  ): Promise<{ ok: boolean; error?: string }>;
};

const PHASES = [
  ["scope", "Scope"],
  ["gather", "Gather"],
  ["challenge", "Challenge"],
  ["synthesize", "Synthesize"],
  ["control", "Control"],
  ["publish", "Publish"],
] as const;

const ACTION_LABELS: Partial<Record<ResearchMissionAction, string>> = {
  continue: "Continue",
  retry: "Retry",
  finish: "Finish now",
  resume: "Resume",
  pause: "Pause",
  cancel: "Cancel run",
  archive: "Archive",
};

function phaseStatus(
  mission: ResearchMission,
  phase: string,
): "pending" | "running" | "succeeded" | "failed" | "skipped" {
  const iteration = mission.iterations.at(-1);
  const step = iteration?.steps?.find((item) => item.id === phase);
  if (step) return step.status;
  if (mission.status === "completed") return "succeeded";
  if (mission.status === "failed" && phase === "scope") return "failed";
  return "pending";
}

export function ResearchMissionDetail({
  mission,
  onOpenSession,
  onOpenUrl,
  onAction,
  onSchedule,
  onAutomationAction,
}: Props) {
  const { announce } = useAnnouncer();
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (!mission) {
    return (
      <section className="research-mission-empty" aria-label="Research mission detail">
        <Icon name="ph:detective" width={28} height={28} aria-hidden />
        <h2>Turn a question into durable knowledge.</h2>
        <p>Start with a bounded brief, landscape sweep, paper, or autoresearch loop.</p>
      </section>
    );
  }

  const iteration = mission.iterations.at(-1);
  const sessionId = iteration?.sessionId;
  const actions = allowedResearchActions(mission);
  const elapsedMinutes = mission.startedAt
    ? Math.max(0, Math.round((Date.parse(mission.finishedAt ?? mission.updatedAt) - Date.parse(mission.startedAt)) / 60_000))
    : 0;
  const reportedCost = mission.iterations.reduce(
    (sum, item) => sum + (item.costUsd ?? 0),
    0,
  );
  const hasReportedCost = mission.iterations.some((item) => item.costUsd !== undefined);
  const runAction = async (input: ResearchMissionActionInput) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await onAction(input);
      if (!result.ok) {
        const message = result.error ?? "Research action failed";
        setActionError(message);
        announce(message);
        return;
      }
      if (input.action === "refine") setDirection("");
      announce(`Research ${input.action} applied.`);
    } finally {
      setBusy(false);
    }
  };
  const runAutomationAction = async (action: "pause" | "resume" | "run-now") => {
    if (!mission.automation) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await onAutomationAction(mission.automation.id, action);
      if (!result.ok) {
        const message = result.error ?? "Automation action failed";
        setActionError(message);
        announce(message);
        return;
      }
      announce(action === "run-now" ? "Research iteration started." : `Schedule ${action}d.`);
    } finally {
      setBusy(false);
    }
  };
  const createSchedule = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await onSchedule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
      if (!result.ok) {
        const message = result.error ?? "Research schedule could not be created";
        setActionError(message);
        announce(message);
        return;
      }
      announce("Paused daily research schedule created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="research-mission-detail" aria-labelledby="research-mission-title">
      <header className="research-mission-detail__header">
        <div>
          <span className="research-mission-detail__eyebrow">
            {mission.mode} · {mission.status}
          </span>
          <h2 id="research-mission-title">{mission.title}</h2>
          <p>{mission.intent}</p>
        </div>
        {sessionId ? (
          <Button
            size="xs"
            variant="ghost"
            leadingIcon="ph:chat-circle-dots"
            onClick={() => onOpenSession(sessionId)}
          >
            Open session
          </Button>
        ) : null}
      </header>

      <div className="research-mission-detail__body">
        <div className="research-evidence-trajectory">
          <div className="research-evidence-trajectory__head">
            <span>Evidence trajectory</span>
            <span>
              iteration {iteration?.number ?? 0}/{mission.bounds.maxIterations}
            </span>
          </div>
          <ol className="research-phase-list" aria-label="Research progress">
            {PHASES.map(([id, label]) => {
              const status = phaseStatus(mission, id);
              const step = iteration?.steps?.find((item) => item.id === id);
              return (
                <li key={id} className={`research-phase research-phase--${status}`}>
                  <span className="research-phase__node" aria-hidden>
                    {status === "succeeded" ? <Icon name="ph:check" width={12} height={12} aria-hidden /> : null}
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <span>{step?.detail || status}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          <dl className="research-bound-meter">
            <div><dt>Time</dt><dd>{elapsedMinutes}/{mission.bounds.wallClockMinutes} min</dd></div>
            <div><dt>Sources</dt><dd>{mission.sources.length}/{mission.bounds.sourceTarget}</dd></div>
            <div><dt>Checkpoint</dt><dd>every {mission.bounds.checkpointEvery} iteration</dd></div>
            <div>
              <dt>Spend</dt>
              <dd>
                {hasReportedCost
                  ? `$${reportedCost.toFixed(2)}${mission.bounds.maxSpendUsd == null ? " reported" : `/$${mission.bounds.maxSpendUsd}`}`
                  : "Cost unavailable"}
              </dd>
            </div>
          </dl>

          {mission.mode === "autoresearch" ? (
            <section className="research-automation" aria-label="AutoResearch schedule">
              <div className="research-automation__summary">
                <div>
                  <span>Codex Automation</span>
                  <strong>{mission.automation ? mission.automation.rrule : "Daily at 09:00 · paused on creation"}</strong>
                </div>
                <span className={`research-automation__status research-automation__status--${mission.automation?.status.toLowerCase() ?? "draft"}`}>
                  {mission.automation?.status ?? "not scheduled"}
                </span>
              </div>
              {mission.automation ? (
                <>
                  <div className="research-automation__controls">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void runAutomationAction(mission.automation!.status === "ACTIVE" ? "pause" : "resume")}
                    >
                      {mission.automation.status === "ACTIVE" ? "Pause schedule" : "Resume schedule"}
                    </Button>
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={busy || mission.status === "completed"}
                      onClick={() => void runAutomationAction("run-now")}
                    >
                      Run now
                    </Button>
                  </div>
                  {mission.automation.lastRunStatus ? (
                    <p>Last run: {mission.automation.lastRunStatus}{mission.automation.lastRunAt ? ` · ${mission.automation.lastRunAt}` : ""}</p>
                  ) : null}
                  {mission.automation.stopReason ? <p className="research-automation__stop">Stopped: {mission.automation.stopReason}</p> : null}
                </>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || ["completed", "cancelled", "archived"].includes(mission.status)}
                  onClick={() => void createSchedule()}
                >
                  Create schedule
                </Button>
              )}
            </section>
          ) : null}

          {actions.length > 0 ? (
            <div className="research-mission-actions" aria-label="Research mission actions">
              {actions.filter((action) => action !== "refine").map((action) => (
                <Button
                  key={action}
                  size="xs"
                  variant={action === "continue" || action === "retry" ? "primary" : action === "cancel" ? "danger-ghost" : "ghost"}
                  disabled={busy}
                  onClick={() => void runAction({ action })}
                >
                  {ACTION_LABELS[action] ?? action}
                </Button>
              ))}
              {actions.includes("refine") ? (
                <details className="research-refine-control">
                  <summary>Refine direction</summary>
                  <textarea
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                    placeholder="What should the next iteration prioritize?"
                    aria-label="Refined research direction"
                  />
                  <Button
                    size="xs"
                    variant="primary"
                    disabled={busy || !direction.trim()}
                    onClick={() => void runAction({ action: "refine", direction })}
                  >
                    Refine and continue
                  </Button>
                </details>
              ) : null}
            </div>
          ) : null}
          {actionError ? <p className="research-mission-error" role="alert">{actionError}</p> : null}

          {mission.lastError ? (
            <div className="research-mission-stop" role="status">
              <Icon name="ph:warning" width={14} height={14} aria-hidden />
              <span>{mission.lastError}</span>
            </div>
          ) : iteration?.decisionReason ? (
            <div className="research-mission-decision" role="status">
              <span>{iteration.decision ?? "checkpoint"}</span>
              <p>{iteration.decisionReason}</p>
            </div>
          ) : null}
        </div>

        <ResearchEvidenceLedger mission={mission} onAction={onAction} onOpenUrl={onOpenUrl} />
      </div>
    </section>
  );
}
