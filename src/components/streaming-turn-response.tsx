"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { TurnResultState } from "@/lib/chat-result-markers";
import { Icon, type IconName } from "@/lib/icon";
import type { StreamingTurnViewModel } from "@/lib/streaming-turn-view-model";
import { StreamingMarkdownBlocks } from "./streaming-markdown-blocks";

const RESULT_PRESENTATION = {
  pending: { icon: "ph:circle", word: "pending" },
  running: { icon: "ph:circle-dashed", word: "running" },
  passed: { icon: "ph:check-circle", word: "passed" },
  attention: { icon: "ph:warning-circle", word: "needs attention" },
  failed: { icon: "ph:x-circle", word: "failed" },
} satisfies Record<TurnResultState, { icon: IconName; word: string }>;

export type StreamingTurnResponseProps = {
  turnId: string;
  familiarName: string;
  model: StreamingTurnViewModel;
  density: "full" | "compact";
  proseContent?: ReactNode;
  activityDetails?: ReactNode;
  supplementaryContent?: ReactNode;
  announceLifecycle?: boolean;
  startedAt?: string;
  durationMs?: number;
  onStop?: () => void;
  canContinue?: boolean;
  onContinue?: () => void;
  onRetry?: () => void;
  onCopyCompleted?: () => void | boolean | Promise<void | boolean>;
};

function isLive(model: StreamingTurnViewModel): boolean {
  return model.status === "working" || model.status === "answering";
}

function TurnResults({ model }: { model: StreamingTurnViewModel }) {
  if (model.results.length === 0) return null;

  return (
    <section
      className="streaming-turn-results"
      aria-label="Results"
      data-turn-results={true}
    >
      <div className="streaming-turn-results__label">Results</div>
      <div role="list">
        {model.results.map((result) => {
          const presentation = RESULT_PRESENTATION[result.state];
          return (
            <div
              key={result.id}
              role="listitem"
              className={`streaming-turn-result streaming-turn-result--${result.state}`}
              aria-label={`${result.label} — ${presentation.word}`}
            >
              <Icon name={presentation.icon} width={14} aria-hidden={true} />
              <span>{result.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TurnActivityDisclosure({
  activityDetails,
  activityOpen,
  activityCount,
  onOpenChange,
  onUserToggle,
}: {
  activityDetails: ReactNode;
  activityOpen: boolean;
  activityCount: number;
  onOpenChange: (open: boolean) => void;
  onUserToggle: () => void;
}) {
  return (
    <details
      className="streaming-turn-activity"
      data-turn-activity={true}
      open={activityOpen || undefined}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className="focus-ring" onClick={onUserToggle}>
        <Icon name={activityOpen ? "ph:caret-down" : "ph:caret-right"} width={12} aria-hidden />
        {`${activityCount} activity ${activityCount === 1 ? "update" : "updates"}`}
      </summary>
      {activityDetails}
    </details>
  );
}

function formatDuration(durationMs?: number, roundNonzeroUp = false): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return null;
  const totalSeconds = Math.max(
    0,
    roundNonzeroUp && durationMs > 0
      ? Math.ceil(durationMs / 1_000)
      : Math.floor(durationMs / 1_000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function transientPreambleFrom(text: string): string | null {
  const candidate = text.trim();
  if (!candidate || candidate.length > 120 || candidate.includes("\n")) return null;
  return /^(?:let me|i(?:'ll| will)|i'm going to)\s+(?:take a look|look|check|inspect|review|search|open|read)\b[^.!?…]*[.!?…]$/i.test(candidate)
    ? candidate
    : null;
}

export function StreamingTurnResponse({
  turnId,
  familiarName,
  model,
  density,
  proseContent,
  activityDetails,
  supplementaryContent,
  announceLifecycle = true,
  startedAt,
  durationMs,
  onStop,
  canContinue,
  onContinue,
  onRetry,
  onCopyCompleted,
}: StreamingTurnResponseProps) {
  const live = isLive(model);
  const [activityOpen, setActivityOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [announceFailure, setAnnounceFailure] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const userToggledActivityRef = useRef(false);
  const previousStatusRef = useRef(model.status);
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsedMs = live && Number.isFinite(startedAtMs)
    ? Math.max(0, now - startedAtMs)
    : durationMs;
  const elapsedLabel = formatDuration(elapsedMs, !live);
  const statusLabel =
    model.status === "working"
      ? "Using tools"
      : model.status === "answering"
        ? "Responding"
        : model.status === "complete"
          ? elapsedLabel
            ? `Completed in ${elapsedLabel}`
            : "Completed"
          : model.status === "interrupted"
            ? "Stopped"
            : "Failed";
  const transientPreamble = live && !model.currentActivity
    ? transientPreambleFrom(model.committedText)
    : null;
  const copyLabel = copied
    ? "Copied"
    : live
      ? "Copy current response"
      : model.status === "complete"
        ? "Copy completed response"
        : "Copy partial response";

  useEffect(() => {
    const enteredComplete =
      previousStatusRef.current !== "complete" && model.status === "complete";
    const enteredFailure =
      previousStatusRef.current !== "failed" && model.status === "failed";
    if (enteredComplete && !userToggledActivityRef.current) {
      setActivityOpen(false);
    }
    setAnnounceFailure(announceLifecycle && enteredFailure);
    previousStatusRef.current = model.status;
  }, [announceLifecycle, model.status]);

  useEffect(() => {
    if (!live || !startedAt) return;
    setNow(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = globalThis.setTimeout(tick, 1_000);
    };
    timer = globalThis.setTimeout(tick, 1_000);
    return () => globalThis.clearTimeout(timer);
  }, [live, startedAt]);

  useEffect(() => {
    if (!copied) return;
    const timer = globalThis.setTimeout(() => setCopied(false), 1_500);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className="streaming-turn-response"
      data-density={density}
      data-streaming-turn-response={true}
      data-streaming-turn-id={turnId}
    >
      <div className="streaming-turn-current">
        <div className="streaming-turn-current__row">
          <Icon
            name={
              live
                ? "ph:circle-notch-bold"
                : model.status === "failed"
                  ? "ph:x-circle"
                  : model.status === "interrupted"
                    ? "ph:warning-circle"
                    : "ph:check-circle"
            }
            width={14}
            aria-hidden
            className={live ? "streaming-turn-current__spinner" : undefined}
          />
          <div
            className="streaming-turn-current__phase"
            role={announceLifecycle && (live || model.status === "interrupted") ? "status" : undefined}
          >
            <strong>{familiarName}</strong>
            <span aria-hidden> · </span>
            {statusLabel}
          </div>
          {live && elapsedLabel ? (
            <time className="streaming-turn-current__time" aria-hidden={true}>{elapsedLabel}</time>
          ) : null}
          <div className="streaming-turn-current__actions">
            {live && onStop ? (
              <Button
                size="xs"
                variant="ghost"
                className="focus-ring"
                aria-label="Stop response"
                onClick={onStop}
              >
                Stop
              </Button>
            ) : null}
            {onCopyCompleted && model.committedText ? (
              <Button
                size="xs"
                variant="ghost"
                className="focus-ring"
                aria-label={copyLabel}
                onClick={() => {
                  void Promise.resolve(onCopyCompleted()).then((succeeded) => {
                    if (succeeded !== false) setCopied(true);
                  });
                }}
              >
                <Icon name={copied ? "ph:check" : "ph:copy"} width={12} aria-hidden />
                {copied ? "Copied" : "Copy"}
              </Button>
            ) : null}
            {model.status === "interrupted" && canContinue && onContinue ? (
              <Button
                size="xs"
                variant="ghost"
                className="focus-ring"
                aria-label="Continue response"
                onClick={onContinue}
              >
                Continue
              </Button>
            ) : null}
            {model.status === "failed" && onRetry ? (
              <Button
                size="xs"
                variant="ghost"
                className="focus-ring"
                aria-label="Retry response"
                onClick={onRetry}
              >
                Retry
              </Button>
            ) : null}
          </div>

          {announceLifecycle && model.status === "complete" ? (
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {`${familiarName} completed response`}
            </span>
          ) : null}
          {announceFailure ? (
            <span className="sr-only" role="alert">
              {`${familiarName} response failed`}
            </span>
          ) : null}
        </div>
        {live && (model.currentActivity?.label || transientPreamble) ? (
          <div
            className="streaming-turn-current__detail"
            data-turn-current-activity={true}
          >
            {model.currentActivity?.label ?? transientPreamble}
          </div>
        ) : null}
      </div>

      <div className="streaming-turn-prose">
        {transientPreamble ? null : proseContent !== undefined ? (
          proseContent
        ) : (
          <StreamingMarkdownBlocks
            committedBlocks={model.committedBlocks}
            activeBlock={model.activeBlock}
            live={live}
          />
        )}
      </div>

      <TurnResults model={model} />

      {supplementaryContent}

      {activityDetails !== undefined ? (
        <TurnActivityDisclosure
          activityDetails={activityDetails}
          activityOpen={activityOpen}
          activityCount={model.activity.length}
          onOpenChange={setActivityOpen}
          onUserToggle={() => {
            userToggledActivityRef.current = true;
          }}
        />
      ) : null}
    </div>
  );
}
