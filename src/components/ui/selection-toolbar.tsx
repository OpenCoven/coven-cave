import type { ReactNode } from "react";

/**
 * Toolbar shown above a list when it's in multi-select mode: a Select all /
 * Clear toggle, an "N selected" count, caller-supplied bulk-action buttons, and
 * a Cancel button. Pairs with `useMultiSelect`. Styling mirrors the chat-list /
 * projects bulk-delete toolbar (#1602) so every surface reads the same.
 */
export function SelectionToolbar({
  allSelected,
  count,
  onToggleSelectAll,
  onCancel,
  children,
}: {
  allSelected: boolean;
  count: number;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  /** Bulk-action buttons (e.g. Pause, Resume, Delete) shown before Cancel. */
  children?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSelectAll}
          className="focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          {allSelected ? "Clear" : "Select all"}
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">{count} selected</span>
      </div>
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
