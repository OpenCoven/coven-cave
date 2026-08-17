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
  activityDetails?: ReactNode;
  supplementaryContent?: ReactNode;
  onStop?: () => void;
  canContinue?: boolean;
  onContinue?: () => void;
  onRetry?: () => void;
  onCopyCompleted?: () => void;
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

function TurnState({
  model,
  onContinue,
  canContinue,
  onRetry,
}: {
  model: StreamingTurnViewModel;
  onContinue?: () => void;
  canContinue?: boolean;
  onRetry?: () => void;
}) {
  if (model.status === "interrupted") {
    return (
      <section
        className="streaming-turn-state streaming-turn-state--interrupted"
        role="status"
        data-turn-state={true}
      >
        <Icon name="ph:warning-circle" width={14} aria-hidden={true} />
        <span>Response stopped</span>
        {canContinue && onContinue ? (
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
      </section>
    );
  }

  if (model.status === "failed") {
    return (
      <section
        className="streaming-turn-state streaming-turn-state--failed"
        role="alert"
        data-turn-state={true}
      >
        <Icon name="ph:x-circle" width={14} aria-hidden={true} />
        <span>Response failed</span>
        {onRetry ? (
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
      </section>
    );
  }

  return null;
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
        {`View activity · ${activityCount} ${activityCount === 1 ? "update" : "updates"}`}
      </summary>
      {activityDetails}
    </details>
  );
}

export function StreamingTurnResponse({
  turnId,
  familiarName,
  model,
  density,
  activityDetails,
  supplementaryContent,
  onStop,
  canContinue,
  onContinue,
  onRetry,
  onCopyCompleted,
}: StreamingTurnResponseProps) {
  const live = isLive(model);
  const [activityOpen, setActivityOpen] = useState(
    density === "full" && model.status === "working",
  );
  const userToggledActivityRef = useRef(false);
  const previousStatusRef = useRef(model.status);

  useEffect(() => {
    const enteredComplete =
      previousStatusRef.current !== "complete" && model.status === "complete";
    if (enteredComplete && !userToggledActivityRef.current) {
      setActivityOpen(false);
    }
    previousStatusRef.current = model.status;
  }, [model.status]);

  return (
    <div
      className="streaming-turn-response"
      data-density={density}
      data-streaming-turn-response={true}
      data-turn-id={turnId}
    >
      {live ? (
        <div className="streaming-turn-current">
          <div className="streaming-turn-current__phase">
            {`${familiarName} is ${model.status === "working" ? "working" : "responding"}`}
          </div>
          {model.currentActivity ? (
            <div
              className="streaming-turn-current__detail"
              data-turn-current-activity={true}
            >
              {model.currentActivity.label}
            </div>
          ) : null}
          {onStop ? (
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
          {onCopyCompleted ? (
            <Button
              size="xs"
              variant="ghost"
              className="focus-ring"
              aria-label="Copy completed text"
              onClick={onCopyCompleted}
            >
              Copy
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="streaming-turn-prose">
        <StreamingMarkdownBlocks
          committedBlocks={model.committedBlocks}
          activeBlock={model.activeBlock}
          live={live}
        />
      </div>

      <TurnResults model={model} />

      <TurnState
        model={model}
        canContinue={canContinue}
        onContinue={onContinue}
        onRetry={onRetry}
      />

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
