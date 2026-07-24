"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { CardStatus } from "@/lib/cave-board-types";

export type FilterOption = { id: string; label: string; checked: boolean };

type Props = {
  /** Which dimension the menu filters — mirrors the active group tab. */
  dimension: "status" | "project";
  statusOptions: { id: CardStatus; label: string; checked: boolean }[];
  projectOptions: FilterOption[];
  onToggleStatus: (id: CardStatus) => void;
  onToggleProject: (id: string) => void;
  onSelectAll: () => void;
  /** Count of active (checked) options and the total, for the badge + "N/M". */
  activeCount: number;
  totalCount: number;
};

export function BoardFilterMenu({
  dimension,
  statusOptions,
  projectOptions,
  onToggleStatus,
  onToggleProject,
  onSelectAll,
  activeCount,
  totalCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const hasFilters = activeCount < totalCount;

  return (
    <div className="board-filter">
      {open ? <div className="board-filter-scrim" onClick={() => setOpen(false)} /> : null}
      <button
        type="button"
        className={`board-filter-btn${hasFilters ? " board-filter-btn--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Icon name="ph:funnel" width={14} />
        Filter
        {hasFilters ? <span className="board-filter-count">{activeCount}</span> : null}
        <Icon name="ph:caret-down" width={11} className={`board-filter-caret${open ? " board-filter-caret--open" : ""}`} />
      </button>
      {open ? (
        <div className="board-filter-menu" role="menu">
          <div className="board-filter-menu-head">
            <span className="board-filter-menu-title">
              Filter by {dimension === "project" ? "project" : "status"}
            </span>
            {hasFilters ? (
              <button type="button" className="board-filter-selectall" onClick={onSelectAll}>
                Select all
              </button>
            ) : null}
          </div>
          {dimension === "status"
            ? statusOptions.map((o) => (
                <button key={o.id} type="button" className="board-filter-item" onClick={() => onToggleStatus(o.id)} role="menuitemcheckbox" aria-checked={o.checked}>
                  <span className={`board-filter-check${o.checked ? " board-filter-check--on" : ""}`}>
                    {o.checked ? <Icon name="ph:check-bold" width={11} /> : null}
                  </span>
                  <span className={`board-filter-dot board-table-status-dot--${o.id}`} />
                  <span className="board-filter-item-label">{o.label}</span>
                </button>
              ))
            : projectOptions.map((o) => (
                <button key={o.id} type="button" className="board-filter-item board-filter-item--mono" onClick={() => onToggleProject(o.id)} role="menuitemcheckbox" aria-checked={o.checked}>
                  <span className={`board-filter-check${o.checked ? " board-filter-check--on" : ""}`}>
                    {o.checked ? <Icon name="ph:check-bold" width={11} /> : null}
                  </span>
                  <span className="board-filter-item-label">{o.label}</span>
                </button>
              ))}
        </div>
      ) : null}
    </div>
  );
}
