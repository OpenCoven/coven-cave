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
          className="pointer-events-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl"
        >
          <div className="mb-1 flex items-start gap-2">
            <Icon name="ph:alarm-fill" className="mt-0.5 shrink-0 text-amber-300" />
            <span className="flex-1 text-sm font-medium text-zinc-100">{t.title}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="grid h-5 w-5 place-items-center text-zinc-500 hover:text-zinc-200"
              aria-label="Dismiss"
            >
              <Icon name="ph:x-bold" />
            </button>
          </div>
          {t.body ? (
            <p className="mb-2 line-clamp-3 text-[11px] text-zinc-400">{t.body}</p>
          ) : null}
          <div className="flex gap-1.5">
            <button
              onClick={() => onDismiss(t.id)}
              className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
            >
              Dismiss
            </button>
            <SnoozeMenu onSnooze={(untilIso) => onSnooze(t, untilIso)} />
            {onOpen ? (
              <button
                onClick={() => onOpen(t)}
                className="rounded bg-rose-700 px-2 py-0.5 text-[10px] text-zinc-50 hover:bg-rose-600"
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
