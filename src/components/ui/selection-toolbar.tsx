import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
  selectAllLabel = "Select all",
  clearLabel = "Clear",
  compact = false,
  countLabel,
  children,
}: {
  allSelected: boolean;
  count: number;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  /** Custom select-all copy (e.g. "Select all 12 matches" under a search). */
  selectAllLabel?: string;
  /** Copy shown when every visible item is selected. */
  clearLabel?: string;
  /** Stacks selection status above actions in constrained containers. */
  compact?: boolean;
  /** Contextual count copy (e.g. "2 failed chats selected"). */
  countLabel?: ReactNode;
  /** Bulk-action buttons (e.g. Pause, Resume, Delete) shown before Cancel. */
  children?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={[
        "ui-selection-toolbar mb-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5",
        compact ? "ui-selection-toolbar--compact" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="ui-selection-toolbar__summary flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={onToggleSelectAll}
        >
          {allSelected ? clearLabel : selectAllLabel}
        </Button>
        <span
          aria-live="polite"
          className="ui-selection-toolbar__count text-[length:var(--text-xs)] text-[var(--text-muted)]"
        >
          {countLabel ?? `${count} selected`}
        </span>
      </div>
      <div className="ui-selection-toolbar__actions flex items-center gap-1">
        {children}
        <Button
          variant="ghost"
          size="xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
