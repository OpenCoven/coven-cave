"use client";

import { useEffect, useRef } from "react";
import type { CardPriority, CardStatus } from "@/lib/cave-board-types";
import { Icon } from "@/lib/icon";

export type FilterState = {
  priorities: Set<CardPriority>;
  familiarIds: Set<string>;
  statuses: Set<CardStatus>;
  labels: Set<string>;
};

export function emptyFilter(): FilterState {
  return { priorities: new Set(), familiarIds: new Set(), statuses: new Set(), labels: new Set() };
}

/** True when the filter popover itself has active selections (priority or status only). */
export function hasActivePopoverFilters(f: FilterState): boolean {
  return f.priorities.size > 0 || f.statuses.size > 0;
}

export function hasActiveFilters(f: FilterState): boolean {
  return f.priorities.size > 0 || f.familiarIds.size > 0 || f.statuses.size > 0 || f.labels.size > 0;
}

const PRIORITY_OPTIONS: { id: CardPriority; label: string }[] = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

const STATUS_OPTIONS: { id: CardStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "inbox", label: "Inbox" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

type Props = {
  filter: FilterState;
  onChange: (f: FilterState) => void;
  onClose: () => void;
};

function CheckOption({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="board-filter-option" onClick={onToggle}>
      <span className={`board-filter-check${checked ? " board-filter-check--on" : ""}`}>
        {checked && <Icon name="ph:check" width={10} className="text-white" />}
      </span>
      {label}
    </button>
  );
}

function toggle<T extends string>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

export function BoardFilterPopover({ filter, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div ref={ref} className="board-filter-popover">
      <div className="board-filter-popover-section">
        <div className="board-filter-popover-label">Priority</div>
        {PRIORITY_OPTIONS.map((o) => (
          <CheckOption key={o.id} checked={filter.priorities.has(o.id)} label={o.label}
            onToggle={() => onChange({ ...filter, priorities: toggle(filter.priorities, o.id) })} />
        ))}
      </div>
      <div className="board-filter-popover-section">
        <div className="board-filter-popover-label">Status</div>
        {STATUS_OPTIONS.map((o) => (
          <CheckOption key={o.id} checked={filter.statuses.has(o.id)} label={o.label}
            onToggle={() => onChange({ ...filter, statuses: toggle(filter.statuses, o.id) })} />
        ))}
      </div>
      <div className="board-filter-popover-footer">
        <button type="button" className="board-toolbar-btn" onClick={() => onChange(emptyFilter())}>Clear all</button>
        <button type="button" className="board-new-card-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
