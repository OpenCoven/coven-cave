"use client";

import type { CodeQueueMode } from "../lib/code-review-queue";

const OPTIONS: ReadonlyArray<{
  id: CodeQueueMode;
  label: string;
  countKey: "reviewableCount" | "allLocalCount";
}> = [
  { id: "reviewable", label: "Reviewable", countKey: "reviewableCount" },
  { id: "all", label: "All local", countKey: "allLocalCount" },
];

export type CodeReviewQueueControlsProps = {
  mode: CodeQueueMode;
  reviewableCount: number;
  allLocalCount: number;
  outsideCurrentFilter?: boolean;
  onModeChange: (mode: CodeQueueMode) => void;
};

export function CodeReviewQueueControls({
  mode,
  reviewableCount,
  allLocalCount,
  outsideCurrentFilter = false,
  onModeChange,
}: CodeReviewQueueControlsProps) {
  const counts = { reviewableCount, allLocalCount };

  return (
    <div className="code-queue-filter">
      <div role="group" aria-label="Session scope" className="code-queue-filter__group">
        {OPTIONS.map((option) => {
          const on = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              className="focus-ring code-queue-filter__button"
              data-on={on ? "true" : undefined}
              onClick={() => onModeChange(option.id)}
            >
              <span className="code-queue-filter__label">{option.label}</span>
              <span className="code-queue-filter__count">{counts[option.countKey]}</span>
            </button>
          );
        })}
      </div>
      {outsideCurrentFilter ? (
        <p className="code-queue-filter__notice">Outside current filter</p>
      ) : null}
    </div>
  );
}
