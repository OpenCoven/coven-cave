"use client";

import { useEffect } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import { SnoozeMenu } from "@/components/snooze-menu";
import { Icon } from "@/lib/icon";

export type Toast = {
  id: string;
  title: string;
  body?: string;
  itemId?: string;
  sessionId?: string | null;
  familiarId?: string | null;
};

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onSnooze: (toast: Toast, untilIso: string) => void;
  onOpen?: (toast: Toast) => void;
};

const AUTO_DISMISS_MS = 8_000;

export function InboxToastStack({ toasts, onDismiss, onSnooze, onOpen }: Props) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => onDismiss(t.id), AUTO_DISMISS_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
          style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
        >
          <div className="mb-1 flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden>
              <Icon name="ph:alarm-fill" />
            </span>
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{t.title}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss"
            >
              <Icon name="ph:x-bold" aria-hidden />
            </button>
          </div>
          {t.body ? (
            <p className="mb-2 line-clamp-3 text-[11px] text-[var(--text-secondary)]">{t.body}</p>
          ) : null}
          <div className="flex gap-1.5">
            <button
              onClick={() => onDismiss(t.id)}
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

export function toastFromItem(item: InboxItem): Toast {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    itemId: item.id,
    sessionId: item.sessionId,
    familiarId: item.familiarId,
  };
}
