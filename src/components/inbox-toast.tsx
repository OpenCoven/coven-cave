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
  /** Interrupt AT speech (role=alert/assertive) — a familiar is blocked on
   *  the user. Routine reminders/digests stay polite. */
  urgent?: boolean;
};

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onSnooze: (toast: Toast, untilIso: string) => void;
  onOpen?: (toast: Toast) => void;
};

const AUTO_DISMISS_MS = 8_000;

export function InboxToastStack({ toasts, onDismiss, onSnooze, onOpen }: Props) {
  // Auto-hide pauses while the pointer or keyboard focus is inside a toast
  // (WCAG 2.2.1) — the underlying inbox item persists either way, but the
  // popup must not vanish mid-read or mid-interaction. Leaving restarts a
  // full window (generous by design).
  const [pausedIds, setPausedIds] = useState<ReadonlySet<string>>(new Set());
  const pause = (id: string) =>
    setPausedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const resume = (id: string) =>
    setPausedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  useEffect(() => {
    // Prune ids whose toasts already left so the set can't grow unbounded.
    setPausedIds((prev) => {
      const live = new Set(toasts.map((t) => t.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [toasts]);
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
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.urgent ? "alert" : "status"}
          aria-live={t.urgent ? "assertive" : "polite"}
          aria-atomic="true"
          className="pointer-events-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
          style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
          onMouseEnter={() => pause(t.id)}
          onMouseLeave={() => resume(t.id)}
          onFocusCapture={() => pause(t.id)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(t.id);
          }}
        >
          <div className="mb-1 flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden>
              <Icon name={t.iconName ?? "ph:alarm-fill"} />
            </span>
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{t.title}</span>
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
            <button
              onClick={() => onDismiss(t.id)}
              aria-label={`Dismiss notification: ${t.title}`}
              className="focus-ring rounded border border-[var(--border-strong)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              Dismiss
            </button>
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
      ))}
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
    // A familiar blocked on the user interrupts; reminders/digests wait
    // their turn in the AT speech queue.
    urgent: item.kind === "response-needed",
  };
}
