"use client";

import type { KeyboardEvent } from "react";

export type ResearchProvenanceTone =
  | "accent"
  | "warn"
  | "muted"
  | "unresolved";

export type ResearchProvenanceEdgeProps = {
  ids: string[];
  selectedId: string | null;
  toneForId: (id: string) => ResearchProvenanceTone;
  onPreview: (id: string | null, element?: HTMLElement) => void;
  onSelect: (id: string) => void;
};

const CONFLICT_ID_RE = /^C\d+$/;
const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export function ResearchProvenanceEdge({
  ids,
  selectedId,
  toneForId,
  onPreview,
  onSelect,
}: ResearchProvenanceEdgeProps) {
  if (ids.length === 0) return null;

  const tabStopId = ids.includes(selectedId ?? "") ? selectedId : ids[0];

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (!NAVIGATION_KEYS.has(event.key)) return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? ids.length - 1
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? (currentIndex - 1 + ids.length) % ids.length
            : (currentIndex + 1) % ids.length;
    const nextId = ids[nextIndex];
    const buttons = event.currentTarget
      .closest('[role="group"]')
      ?.querySelectorAll<HTMLButtonElement>(
        "[data-research-provenance-id]",
      );
    const nextButton = buttons?.[nextIndex];
    if (!nextId || !nextButton) return;

    nextButton.focus();
  };

  return (
    <div
      className="research-provenance-edge"
      role="group"
      aria-label={`Evidence references · ${ids.length}`}
    >
      {ids.map((id, index) => {
        const conflict = CONFLICT_ID_RE.test(id);
        const selected = selectedId === id;
        const tone = conflict ? "warn" : toneForId(id);

        return (
          <button
            key={`${id}-${index}`}
            className={`research-provenance-edge__item research-provenance-edge__item--${tone} focus-ring${selected ? " is-selected" : ""}`}
            type="button"
            aria-label={`${conflict ? "Open conflict" : "Open evidence"} ${id}`}
            aria-current={selected ? "true" : undefined}
            data-research-provenance-id={id}
            data-selected={selected ? "true" : "false"}
            data-tone={tone}
            tabIndex={id === tabStopId ? 0 : -1}
            onMouseEnter={(event) => onPreview(id, event.currentTarget)}
            onMouseLeave={() => onPreview(null)}
            onFocus={(event) => {
              const buttons = event.currentTarget
                .closest('[role="group"]')
                ?.querySelectorAll<HTMLButtonElement>(
                  "[data-research-provenance-id]",
                );
              buttons?.forEach((button) => {
                button.tabIndex = button === event.currentTarget ? 0 : -1;
              });
              onPreview(id, event.currentTarget);
            }}
            onBlur={() => onPreview(null)}
            onKeyDown={(event) => moveFocus(event, index)}
            onClick={() => onSelect(id)}
          >
            {id}
          </button>
        );
      })}
    </div>
  );
}
