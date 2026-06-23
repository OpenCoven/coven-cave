"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import {
  parseWorkflowStepProgress,
  type WorkflowStepProgressStatus,
} from "@/lib/workflow-step-progress";
import type { WorkflowRunRecord } from "@/lib/workflows";

const STATUS_ICON: Record<WorkflowStepProgressStatus, IconName> = {
  pending: "ph:circle-dashed",
  active: "ph:circle-notch-bold",
  succeeded: "ph:check-circle",
  failed: "ph:x-circle-fill",
};

const POLL_MS = 2500;

/**
 * Live per-step progress for a session-executor run. Polls the run's agent
 * session transcript, maps the agent's `@@step-…` markers back onto the
 * manifest's steps, and shows each step's status with its narration (the
 * debugging detail) on demand. When the agent emitted no markers, the raw live
 * output is shown instead so the detail is never hidden.
 */
export function WorkflowRunProgress({ run }: { run: WorkflowRunRecord }) {
  const sessionId = run.sessionId;
  const live = run.status === "running" || run.status === "queued";
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (json?.ok && Array.isArray(json.conversation?.turns)) {
          const text = json.conversation.turns
            .filter((t: { role?: string }) => t.role === "assistant")
            .map((t: { text?: string }) => t.text ?? "")
            .join("\n");
          setTranscript(text);
          setError(null);
        } else {
          setTranscript((prev) => prev ?? "");
        }
      } catch {
        if (alive) setError("Couldn't load the run's session output.");
      }
      if (alive && live) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, live]);

  if (!sessionId) return null;

  const stepIds = run.steps.map((s) => s.id);
  const progress = parseWorkflowStepProgress(transcript ?? "", stepIds);
  const active = progress.steps.find((s) => s.id === progress.activeStepId) ?? null;
  const resolved = progress.steps.filter((s) => s.status === "succeeded" || s.status === "failed").length;

  const headline = progress.done
    ? `All ${stepIds.length} steps reported`
    : active
      ? `Running: ${active.id}`
      : live
        ? "Waiting for the agent…"
        : `${resolved}/${stepIds.length} steps reported`;

  return (
    <div className="workflow-run-progress">
      <div className="workflow-run-progress-head">
        {live && !progress.done && (
          <Icon name="ph:circle-notch-bold" width={12} className="workflow-spin" aria-hidden />
        )}
        <span>{headline}</span>
      </div>

      {progress.markersFound ? (
        <ol className="workflow-progress-steps">
          {progress.steps.map((step) => {
            const open = openStep === step.id;
            const hasDetail = step.detail.length > 0;
            return (
              <li
                key={step.id}
                className={`workflow-progress-step workflow-run-step-${
                  step.status === "active" ? "ready" : step.status
                } workflow-progress-step--${step.status}`}
              >
                <button
                  type="button"
                  className="workflow-progress-step-row"
                  aria-expanded={hasDetail ? open : undefined}
                  disabled={!hasDetail}
                  onClick={() => setOpenStep(open ? null : step.id)}
                >
                  <Icon
                    name={STATUS_ICON[step.status]}
                    width={13}
                    className={step.status === "active" ? "workflow-spin" : ""}
                  />
                  <span className="workflow-run-step-id">{step.id}</span>
                  <span className="workflow-run-step-status">{step.status}</span>
                  {hasDetail && <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />}
                </button>
                {open && hasDetail && <pre className="workflow-progress-step-detail">{step.detail}</pre>}
              </li>
            );
          })}
        </ol>
      ) : transcript ? (
        <pre className="workflow-progress-step-detail workflow-progress-raw">
          {transcript.slice(-6000) || "…"}
        </pre>
      ) : (
        <p className="workflow-muted">Waiting for the agent's first output…</p>
      )}
      {error && <p className="workflow-muted">{error}</p>}
    </div>
  );
}
