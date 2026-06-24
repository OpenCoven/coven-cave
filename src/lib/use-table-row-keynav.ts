"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keyboard navigation for an interactive table's item rows. ↑/↓ + Home/End rove
 * a single tab stop between rows matching `rowSelector`; Enter/Space activates
 * the focused row via its native click, so it shares the row's existing onClick
 * logic (select-mode toggle, open preview, …).
 *
 * The hook owns the rows' `tabIndex` (one row is 0, the rest -1) imperatively —
 * do NOT set `tabIndex` on the rows in JSX, or React will fight it. It only acts
 * when a row element itself is focused, so inner controls (links, delete
 * buttons) keep their own Enter/Space/arrow behavior.
 *
 * `rowCount` is a dependency so the listeners + initial tab stop (re)bind once
 * the table mounts after an async data load — these lists render the <table>
 * only after fetching, so a mount-time-only bind would miss the rows.
 */
export function useTableRowKeyboardNav(
  tbodyRef: RefObject<HTMLTableSectionElement | null>,
  rowCount: number,
  options: { rowSelector?: string; disabled?: boolean } = {},
): void {
  const { rowSelector = 'tr[data-row="true"]', disabled = false } = options;
  useEffect(() => {
    const tbody = tbodyRef.current;
    // Disabled e.g. in bulk-select mode, where the rows are independently
    // tabbable checkboxes and own their own keyboard handling.
    if (disabled || !tbody) return;

    const rows = () => Array.from(tbody.querySelectorAll<HTMLElement>(rowSelector));
    const setStop = (row: HTMLElement | null) => {
      for (const r of rows()) r.tabIndex = r === row ? 0 : -1;
    };
    // Ensure exactly one tab stop so the list is reachable by Tab.
    const list0 = rows();
    if (list0.length > 0 && !list0.some((r) => r.tabIndex === 0)) setStop(list0[0]);

    const focusRow = (i: number) => {
      const list = rows();
      if (list.length === 0) return;
      list[Math.max(0, Math.min(list.length - 1, i))]?.focus();
    };
    const onFocusIn = (e: FocusEvent) => {
      const row = (e.target as HTMLElement | null)?.closest?.(rowSelector) as HTMLElement | null;
      if (row) setStop(row);
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Only act when a row itself is focused — not an inner control or field.
      const row = target?.closest?.(rowSelector) as HTMLElement | null;
      if (!row || target !== row) return;
      const list = rows();
      const i = list.indexOf(row);
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); focusRow(i + 1); break;
        case "ArrowUp": e.preventDefault(); focusRow(i - 1); break;
        case "Home": e.preventDefault(); focusRow(0); break;
        case "End": e.preventDefault(); focusRow(list.length - 1); break;
        case "Enter":
        case " ": e.preventDefault(); row.click(); break;
      }
    };

    tbody.addEventListener("focusin", onFocusIn);
    tbody.addEventListener("keydown", onKey);
    return () => {
      tbody.removeEventListener("focusin", onFocusIn);
      tbody.removeEventListener("keydown", onKey);
    };
  }, [tbodyRef, rowCount, rowSelector, disabled]);
}
