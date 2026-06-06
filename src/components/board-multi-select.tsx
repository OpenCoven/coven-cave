"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";

type Option = { id: string; label: string };

type Props = {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Icon name (Phosphor) shown before the label */
  icon?: IconName;
  emptyLabel?: string;
};

export function BoardMultiSelect({ label, options, selected, onChange, icon, emptyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  const active = selected.size > 0;

  return (
    <div ref={ref} className="board-filter-popover-anchor">
      <button
        type="button"
        className={`board-toolbar-select board-multiselect-btn${active ? " board-toolbar-select--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {icon && <Icon name={icon} width={12} height={12} />}
        <span>{active ? `${label} · ${selected.size}` : label}</span>
        <Icon
          name="ph:caret-down-bold"
          width={9}
          height={9}
          className={`board-multiselect-caret${open ? " board-multiselect-caret--open" : ""}`}
        />
      </button>

      {open && (
        <div className="board-filter-popover board-multiselect-popover">
          {options.length === 0 ? (
            <div className="board-filter-popover-section">
              <p className="board-table-muted" style={{ padding: "4px 2px", fontSize: 12 }}>
                {emptyLabel ?? "No options"}
              </p>
            </div>
          ) : (
            <div className="board-filter-popover-section">
              {options.map((o) => {
                const checked = selected.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="board-filter-option"
                    onClick={() => toggle(o.id)}
                  >
                    <span className={`board-filter-check${checked ? " board-filter-check--on" : ""}`}>
                      {checked && <Icon name="ph:check" width={10} className="text-white" />}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          {selected.size > 0 && (
            <div className="board-filter-popover-footer">
              <button
                type="button"
                className="board-toolbar-btn"
                onClick={() => { onChange(new Set()); setOpen(false); }}
              >
                Clear
              </button>
              <button
                type="button"
                className="board-new-card-btn"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
