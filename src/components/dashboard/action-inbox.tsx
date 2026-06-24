"use client";

import { useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { InboxItem } from "@/lib/cave-inbox";
import { KIND_ICON, KIND_LABEL, itemHasTarget, itemHref, relativeTime } from "@/lib/daily-report";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
import { nextItemsAfterAction } from "@/lib/dashboard-model";

type Action = "done" | "dismiss" | "snooze";

/** Snooze durations offered in the per-row menu. `minutes` resolves at click. */
const SNOOZE_OPTIONS: { label: string; minutes: () => number }[] = [
  { label: "1 hour", minutes: () => 60 },
  { label: "3 hours", minutes: () => 180 },
  { label: "Tomorrow morning", minutes: () => minutesUntilTomorrowMorning() },
];

/** Whole minutes from now until 9am the next calendar day. */
function minutesUntilTomorrowMorning(): number {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
}

export function ActionInbox({ initialItems }: { initialItems: InboxItem[] }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  // Bulk triage: select several items and done/dismiss/snooze them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkSnoozeOpen, setBulkSnoozeOpen] = useState(false);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const selectedCount = items.filter((i) => selectedIds.has(i.id)).length;
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) items.forEach((i) => next.delete(i.id));
      else items.forEach((i) => next.add(i.id));
      return next;
    });

  function requestInit(action: Action, minutes: number): RequestInit {
    return action === "snooze"
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes }) }
      : { method: "POST" };
  }

  async function act(item: InboxItem, action: Action, minutes = 60) {
    const prev = items;
    setItems(nextItemsAfterAction(items, item.id)); // optimistic remove
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${item.id}/${action}`, requestInit(action, minutes));
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setItems(prev); // revert
      setError("Couldn't update that item — try again.");
    }
  }

  // Apply one action to every selected item: optimistic remove + parallel POSTs.
  async function bulkAct(action: Action, minutes = 60) {
    const ids = items.filter((i) => selectedIds.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    const prev = items;
    setItems(items.filter((i) => !selectedIds.has(i.id)));
    exitSelect();
    setError(null);
    try {
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/inbox/${id}/${action}`, requestInit(action, minutes)).then((r) => r.ok)),
      );
      if (results.some((ok) => !ok)) throw new Error("partial");
    } catch {
      setItems(prev); // revert the whole batch
      setError("Couldn't update some items — try again.");
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="dr-section" aria-label="Needs you">
      <div className="dr-section__head">
        <h2 className="dr-section__title">
          <Icon name="ph:warning-circle" aria-hidden />
          Needs you
        </h2>
        <span className="dr-count">{items.length}</span>
        {items.length > 1 ? (
          <button
            type="button"
            className="dash-act dash-inbox__select-toggle"
            aria-pressed={selectMode}
            onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
          >
            <Icon name="ph:list-checks-bold" aria-hidden />
            {selectMode ? "Done" : "Select"}
          </button>
        ) : null}
      </div>
      {selectMode ? (
        <div className="dash-inbox__bulkbar">
          <div className="dash-inbox__bulkbar-left">
            <button type="button" className="dash-act dash-act--ghost" onClick={toggleSelectAll}>
              {allSelected ? "Clear" : "Select all"}
            </button>
            <span className="dash-inbox__bulkbar-count">{selectedCount} selected</span>
          </div>
          <div className="dash-inbox__bulkbar-right">
            <SnoozeMenu
              open={bulkSnoozeOpen}
              onToggle={() => setBulkSnoozeOpen((v) => !v)}
              onClose={() => setBulkSnoozeOpen(false)}
              onPick={(minutes) => { setBulkSnoozeOpen(false); void bulkAct("snooze", minutes); }}
              disabled={selectedCount === 0}
            />
            <button type="button" className="dash-act dash-act--primary" disabled={selectedCount === 0} onClick={() => void bulkAct("done")}>
              Done{selectedCount ? ` ${selectedCount}` : ""}
            </button>
            <button type="button" className="dash-act dash-act--ghost" disabled={selectedCount === 0} onClick={() => void bulkAct("dismiss")}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="dash-inbox__error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="dr-list">
        {items.map((item) => {
          const whenIso = item.firedAt ?? item.updatedAt;
          const when = relativeTime(whenIso);
          const whenTitle = whenIso ? formatTimestamp(whenIso, readDateTimePrefs()) : undefined;
          return (
          <div
            key={item.id}
            className={`dr-row dash-inbox__row${selectMode ? " focus-ring-inset" : ""}${selectMode && selectedIds.has(item.id) ? " dash-inbox__row--selected" : ""}`}
            style={{ ["--row-accent" as string]: "var(--color-warning)" }}
            role={selectMode ? "checkbox" : undefined}
            aria-checked={selectMode ? selectedIds.has(item.id) : undefined}
            tabIndex={selectMode ? 0 : undefined}
            onClick={selectMode ? () => toggleSelect(item.id) : undefined}
            onKeyDown={selectMode ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelect(item.id); } } : undefined}
          >
            {selectMode ? (
              <span aria-hidden className="dash-inbox__check" data-checked={selectedIds.has(item.id) ? "true" : undefined}>
                <Icon name="ph:check-bold" aria-hidden />
              </span>
            ) : null}
            <span className="dr-row__icon">
              <Icon name={KIND_ICON[item.kind] as IconName} aria-hidden />
            </span>
            <span className="dr-row__body">
              <span className="dr-row__title">{item.title}</span>
              {item.body ? <span className="dr-row__sub">{item.body}</span> : null}
              <span className="dr-row__metaline">
                <span className="dr-tag">{KIND_LABEL[item.kind]}</span>
                {when ? <span className="dr-row__time" title={whenTitle}>{when}</span> : null}
              </span>
            </span>
            {selectMode ? null : (
            <span className="dash-inbox__actions">
              {itemHasTarget(item) ? (
                <a className="dash-act" href={itemHref(item)}>
                  Open
                </a>
              ) : null}
              <SnoozeMenu
                open={snoozeOpenId === item.id}
                onToggle={() => setSnoozeOpenId(snoozeOpenId === item.id ? null : item.id)}
                onClose={() => setSnoozeOpenId(null)}
                onPick={(minutes) => {
                  setSnoozeOpenId(null);
                  void act(item, "snooze", minutes);
                }}
              />
              <button type="button" className="dash-act dash-act--primary" onClick={() => act(item, "done")}>
                Done
              </button>
              <button
                type="button"
                className="dash-act dash-act--ghost"
                aria-label="Dismiss"
                onClick={() => act(item, "dismiss")}
              >
                <Icon name="ph:x" aria-hidden />
              </button>
            </span>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Snooze split button + duration menu. Trapping focus inside the open menu
 * (via the shared useFocusTrap) gives it the keyboard behaviour the rest of
 * the app's popovers have: the first option is focused on open, Tab/Shift+Tab
 * cycle the options, Escape closes the menu and returns focus to the trigger.
 */
function SnoozeMenu({
  open,
  onToggle,
  onClose,
  onPick,
  disabled = false,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (minutes: number) => void;
  disabled?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, menuRef, { onEscape: onClose });
  return (
    <div className="dash-snooze">
      <button
        type="button"
        className="dash-act"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        Snooze
        <Icon name="ph:caret-down" aria-hidden />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="dash-snooze__backdrop"
            aria-label="Close snooze menu"
            onClick={onClose}
          />
          <div ref={menuRef} className="dash-snooze__menu" role="menu" aria-label="Snooze for">
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                role="menuitem"
                className="dash-snooze__opt"
                onClick={() => onPick(opt.minutes())}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
