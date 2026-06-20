"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import { KIND_ICON, KIND_LABEL, itemHasTarget, itemHref, relativeTime } from "@/lib/daily-report";
import { nextItemsAfterAction } from "@/lib/dashboard-model";

type Action = "done" | "dismiss" | "snooze";

export function ActionInbox({ initialItems }: { initialItems: InboxItem[] }) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [error, setError] = useState<string | null>(null);

  async function act(item: InboxItem, action: Action) {
    const prev = items;
    setItems(nextItemsAfterAction(items, item.id)); // optimistic remove
    setError(null);
    try {
      const init: RequestInit =
        action === "snooze"
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ minutes: 60 }),
            }
          : { method: "POST" };
      const res = await fetch(`/api/inbox/${item.id}/${action}`, init);
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setItems(prev); // revert
      setError("Couldn't update that item — try again.");
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
      </div>
      {error ? (
        <div className="dash-inbox__error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="dr-list">
        {items.map((item) => {
          const when = relativeTime(item.firedAt ?? item.updatedAt);
          return (
          <div
            key={item.id}
            className="dr-row dash-inbox__row"
            style={{ ["--row-accent" as string]: "var(--color-warning)" }}
          >
            <span className="dr-row__icon">
              <Icon name={KIND_ICON[item.kind] as IconName} aria-hidden />
            </span>
            <span className="dr-row__body">
              <span className="dr-row__title">{item.title}</span>
              {item.body ? <span className="dr-row__sub">{item.body}</span> : null}
              <span className="dr-row__metaline">
                <span className="dr-tag">{KIND_LABEL[item.kind]}</span>
                {when ? <span className="dr-row__time">{when}</span> : null}
              </span>
            </span>
            <span className="dash-inbox__actions">
              {itemHasTarget(item) ? (
                <a className="dash-act" href={itemHref(item)}>
                  Open
                </a>
              ) : null}
              <button type="button" className="dash-act" onClick={() => act(item, "snooze")}>
                Snooze
              </button>
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
          </div>
          );
        })}
      </div>
    </section>
  );
}
