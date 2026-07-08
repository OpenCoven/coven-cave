"use client";

import { useEffect, useState } from "react";
import type { InboxItem, InboxMedia, LinkRef } from "@/lib/cave-inbox";
import { SnoozeMenu } from "@/components/snooze-menu";
import { Icon, type IconName } from "@/lib/icon";

export type Toast = {
  id: string;
  title: string;
  body?: string;
  itemId?: string;
  sessionId?: string | null;
  familiarId?: string | null;
  link?: LinkRef | null;
  iconName?: IconName;
  media?: InboxMedia | null;
  /** Inbox kind — drives announcement urgency (response-needed → assertive). */
  kind?: InboxItem["kind"];
};

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onSnooze: (toast: Toast, untilIso: string) => void;
  onOpen?: (toast: Toast) => void;
};

const AUTO_DISMISS_MS = 8_000;

export function InboxToastStack({ toasts, onDismiss, onSnooze, onOpen }: Props) {
  // Hover or focus anywhere inside a toast pauses its auto-hide (WCAG 2.2.1) —
  // content stopped vanishing mid-read. Unpausing re-arms the full window,
  // the generous simple option (no per-toast remaining-time bookkeeping).
  const [pausedIds, setPausedIds] = useState<ReadonlySet<string>>(new Set());
  const setPaused = (id: string, paused: boolean) =>
    setPausedIds((prev) => {
      if (prev.has(id) === paused) return prev;
      const next = new Set(prev);
      if (paused) next.add(id);
      else next.delete(id);
      return next;
    });

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter((t) => !pausedIds.has(t.id))
      .map((t) => setTimeout(() => onDismiss(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, pausedIds, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        // A reply request is time-critical for the user — announce it
        // assertively; everything else stays polite.
        const urgent = t.kind === "response-needed";
        return (
        <div
          key={t.id}
          role={urgent ? "alert" : "status"}
          aria-live={urgent ? "assertive" : "polite"}
          aria-atomic="true"
          onMouseEnter={() => setPaused(t.id, true)}
          onMouseLeave={() => setPaused(t.id, false)}
          onFocus={() => setPaused(t.id, true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(t.id, false);
          }}
          className="pointer-events-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
          style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
        >
          <div className="mb-1 flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden>
              <Icon name={t.iconName ?? "ph:alarm-fill"} />
            </span>
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{t.title}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label={`Dismiss: ${t.title}`}
            >
              <Icon name="ph:x-bold" aria-hidden />
            </button>
          </div>
          {t.media?.imageUrl ? (
            <img
              src={t.media.imageUrl}
              alt={t.media.alt}
              className="mb-2 h-24 w-full rounded-md border border-[var(--border-hairline)] object-cover"
            />
          ) : null}
          {t.body ? (
            <p className="mb-2 line-clamp-3 text-[11px] text-[var(--text-secondary)]">{t.body}</p>
          ) : null}
          <div className="flex gap-1.5">
            <SnoozeMenu onSnooze={(untilIso) => onSnooze(t, untilIso)} />
            {onOpen ? (
              <button
                onClick={() => onOpen(t)}
                className="focus-ring rounded bg-[var(--accent-presence)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)]"
              >
                Open
              </button>
            ) : null}
          </div>
        </div>
        );
      })}
    </div>
  );
}

function toastIconForItem(item: InboxItem): IconName {
  if (item.kind === "daily-summary") return "ph:newspaper";
  if (item.kind === "response-needed") return "ph:chat-circle-dots-fill";
  if (item.kind === "agent") return "ph:magic-wand-fill";
  return "ph:alarm-fill";
}

export function toastFromItem(item: InboxItem): Toast {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    itemId: item.id,
    sessionId: item.sessionId,
    familiarId: item.familiarId,
    link: item.link,
    iconName: toastIconForItem(item),
    media: item.media,
    kind: item.kind,
  };
}
