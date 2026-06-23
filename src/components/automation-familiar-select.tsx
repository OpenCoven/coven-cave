"use client";

import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  isAllSelected,
  selectAll,
  toggleFamiliarSelection,
} from "@/lib/familiar-multiselect";

type Props = {
  /** Resolved familiars (FamiliarAvatar needs ResolvedFamiliar, not raw Familiar). */
  familiars: ResolvedFamiliar[];
  /** Empty set = "All". */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

const chipClass = (active: boolean) =>
  [
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] transition-colors",
    active
      ? "border-transparent bg-[var(--bg-raised)] text-[var(--text-primary)]"
      : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
  ].join(" ");

/**
 * Familiar filter for the Automations tab: an "All" chip (default) plus one chip
 * per familiar. Plain click selects only that familiar; ⌘/Ctrl-click toggles it
 * into a multi-selection. Empty selection = All. Reused by Slice B's create/edit
 * form. Pure selection logic lives in `@/lib/familiar-multiselect`.
 */
export function FamiliarMultiSelect({ familiars, selected, onChange }: Props) {
  const all = isAllSelected(selected);
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Filter automations by familiar"
    >
      <button
        type="button"
        aria-pressed={all}
        className={chipClass(all)}
        onClick={() => onChange(selectAll())}
      >
        All
      </button>
      {familiars.map((f) => {
        const active = selected.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            title={`${f.display_name} — click to filter, ⌘-click to multi-select`}
            className={chipClass(active)}
            onClick={(e) =>
              onChange(toggleFamiliarSelection(selected, f.id, e.metaKey || e.ctrlKey))
            }
          >
            <FamiliarAvatar familiar={f} size="sm" />
            <span className="max-w-[120px] truncate">{f.display_name}</span>
          </button>
        );
      })}
      {familiars.length > 1 && (
        <span className="ml-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ⌘-click to combine
        </span>
      )}
    </div>
  );
}
