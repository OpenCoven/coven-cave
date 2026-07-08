"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useMinuteTick } from "@/lib/use-minute-tick";
import type { InboxItem } from "@/lib/cave-inbox";
import { KIND_ICON, KIND_LABEL, itemHasTarget, itemHref, relativeTime } from "@/lib/daily-report";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
import { nextItemsAfterAction } from "@/lib/dashboard-model";
import { SnoozeMenu, minutesUntilTomorrowMorning, type SnoozeOption } from "@/components/snooze-menu";
import { useAnnouncer } from "@/components/ui/live-region";

type Action = "done" | "dismiss" | "snooze";

/** Snooze durations offered in the per-row menu. `minutes` resolves at click. */
const SNOOZE_OPTIONS: SnoozeOption[] = [
  { label: "1 hour", minutes: () => 60 },
  { label: "3 hours", minutes: () => 180 },
  { label: "Tomorrow morning", minutes: () => minutesUntilTomorrowMorning() },
];

const ACTION_PAST_TENSE: Record<Action, string> = {
  done: "Marked done",
  dismiss: "Dismissed",
  snooze: "Snoozed",
};

export function ActionInbox({ initialItems }: { initialItems: InboxItem[] }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  useMinuteTick();    // keep the per-item "Nm ago" labels current; the parent
                      // cockpit re-fetches the list itself every 30s.
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  // Bulk triage: select several items and done/dismiss/snooze them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
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
      // The row disappears optimistically, which is invisible to AT — say what
      // happened (error feedback already has the role=alert banner).
      announce(`${ACTION_PAST_TENSE[action]} '${item.title}'.`);
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
      announce(`${ACTION_PAST_TENSE[action]} ${ids.length} ${ids.length === 1 ? "item" : "items"}.`);
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
              className="dash-snooze"
              triggerClassName="dash-act"
              menuClassName="dash-snooze__menu"
              optionClassName="dash-snooze__opt"
              options={SNOOZE_OPTIONS}
              onSnooze={(_untilIso, minutes) => void bulkAct("snooze", minutes)}
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
                className="dash-snooze"
                triggerClassName="dash-act"
                menuClassName="dash-snooze__menu"
                optionClassName="dash-snooze__opt"
                options={SNOOZE_OPTIONS}
                onSnooze={(_untilIso, minutes) => void act(item, "snooze", minutes)}
              />
              <button type="button" className="dash-act dash-act--primary" onClick={() => act(item, "done")}>
                Done
              </button>
              <button
                type="button"
                className="dash-act dash-act--ghost"
                aria-label={`Dismiss '${item.title}'`}
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

// The snooze split button + duration menu lives in the shared
// @/components/snooze-menu now (this file used to carry its own copy) — one
// component owns the menu semantics + focus trap for every inbox surface.
