"use client";

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { CardStatus } from "@/lib/cave-board-types";

export type FilterOption = { id: string; label: string; checked: boolean };

type Props = {
  /** List project sections too: while grouped by project, or while one is
      hidden, so a hidden section can always be brought back (#6561). */
  showProjects: boolean;
  statusOptions: { id: CardStatus; label: string; checked: boolean }[];
  projectOptions: FilterOption[];
  onToggleStatus: (id: CardStatus) => void;
  onToggleProject: (id: string) => void;
  onSelectAll: () => void;
  /** Sections hidden across both dimensions, for the badge. */
  hiddenCount: number;
};

function FilterItem({ option, mono, dotClass, onToggle }: {
  option: FilterOption;
  mono?: boolean;
  dotClass?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`board-filter-item${mono ? " board-filter-item--mono" : ""}`}
      onClick={onToggle}
      role="menuitemcheckbox"
      aria-checked={option.checked}
    >
      <span className={`board-filter-check${option.checked ? " board-filter-check--on" : ""}`}>
        {option.checked ? <Icon name="ph:check-bold" width={11} /> : null}
      </span>
      {dotClass ? <span className={`board-filter-dot ${dotClass}`} /> : null}
      <span className="board-filter-item-label">{option.label}</span>
    </button>
  );
}

export function BoardFilterMenu({
  showProjects,
  statusOptions,
  projectOptions,
  onToggleStatus,
  onToggleProject,
  onSelectAll,
  hiddenCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasFilters = hiddenCount > 0;
  const listProjects = showProjects && projectOptions.length > 0;

  return (
    <div
      className="board-filter"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      {open ? <div className="board-filter-scrim" onClick={() => setOpen(false)} /> : null}
      <button
        ref={buttonRef}
        type="button"
        className={`board-filter-btn${hasFilters ? " board-filter-btn--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Icon name="ph:funnel" width={14} />
        Filter
        {hasFilters ? (
          <span className="board-filter-count">
            {hiddenCount}
            <span className="sr-only">{hiddenCount === 1 ? " section hidden" : " sections hidden"}</span>
          </span>
        ) : null}
        <Icon name="ph:caret-down" width={11} className={`board-filter-caret${open ? " board-filter-caret--open" : ""}`} />
      </button>
      {open ? (
        <div className="board-filter-menu" role="menu" aria-label="Filter sections">
          <div role="group" aria-labelledby="board-filter-status-title">
            <div className="board-filter-menu-head">
              <span id="board-filter-status-title" className="board-filter-menu-title">Filter by status</span>
              {hasFilters ? (
                <button type="button" className="board-filter-selectall" onClick={onSelectAll}>
                  Select all
                </button>
              ) : null}
            </div>
            {statusOptions.map((o) => (
              <FilterItem key={o.id} option={o} dotClass={`board-table-status-dot--${o.id}`} onToggle={() => onToggleStatus(o.id)} />
            ))}
          </div>
          {listProjects ? (
            <div role="group" aria-labelledby="board-filter-project-title" className="board-filter-menu-group">
              <div className="board-filter-menu-head">
                <span id="board-filter-project-title" className="board-filter-menu-title">Filter by project</span>
              </div>
              {projectOptions.map((o) => (
                <FilterItem key={o.id} option={o} mono onToggle={() => onToggleProject(o.id)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
