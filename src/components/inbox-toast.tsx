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
  /**
   * Auto-hide timeout. Distinct from onDismiss (the explicit ✕): expiry means
   * the user may never have seen the toast, so the caller must NOT resolve or
   * acknowledge the underlying item — it stays unread in the bell. Falls back
   * to onDismiss when absent.
   */
  onExpire?: (id: string) => void;
  onSnooze: (toast: Toast, untilIso: string) => void;
  onOpen?: (toast: Toast) => void;
};

const AUTO_DISMISS_MS = 8_000;

/* Each kind wears its own tint — the daily report and familiar work carry
   presence, while time-critical kinds keep the warning hue. The icon chip is
   the toast's one flourish; everything else stays quiet surface. */
const KIND_ACCENT: Record<NonNullable<Toast["kind"]>, string> = {
  "daily-summary": "var(--accent-presence)",
  agent: "var(--accent-presence)",
  "response-needed": "var(--color-warning)",
  reminder: "var(--color-warning)",
};

export function InboxToastStack({ toasts, onDismiss, onExpire, onSnooze, onOpen }: Props) {
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
    const expire = onExpire ?? onDismiss;
    const timers = toasts
      .filter((t) => !pausedIds.has(t.id))
      .map((t) => setTimeout(() => expire(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, pausedIds, onDismiss, onExpire]);

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
          className="glass-overlay pointer-events-auto rounded-xl border border-[var(--border-strong)] p-3 shadow-2xl"
          style={{
            animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)",
            ["--toast-accent" as string]: KIND_ACCENT[t.kind ?? "reminder"],
          }}
        >
          <div className="mb-1 flex items-start gap-2.5">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklch,var(--toast-accent)_14%,transparent)] text-[var(--toast-accent)]"
              aria-hidden
            >
              <Icon name={t.iconName ?? "ph:alarm-fill"} />
            </span>
            <span className="flex-1 pt-0.5 text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{t.title}</span>
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
            <p className="mb-2.5 line-clamp-3 pl-[34px] text-[11px] leading-relaxed text-[var(--text-secondary)]">{t.body}</p>
          ) : null}
          <div className="flex items-center justify-end gap-1.5">
            <SnoozeMenu
              onSnooze={(untilIso) => onSnooze(t, untilIso)}
              triggerClassName="focus-ring rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            />
            {onOpen ? (
              <button
                onClick={() => onOpen(t)}
                className="focus-ring rounded-full border border-[color-mix(in_oklch,var(--toast-accent)_35%,transparent)] bg-[color-mix(in_oklch,var(--toast-accent)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--toast-accent)] transition-colors hover:bg-[color-mix(in_oklch,var(--toast-accent)_18%,transparent)]"
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
