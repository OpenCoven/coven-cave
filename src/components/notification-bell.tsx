"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem } from "@/lib/cave-inbox";

type Props = {
  items: InboxItem[];
  onOpenInbox: () => void;
  onOpenItem?: (item: InboxItem) => void;
};

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(Math.abs(diff) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell({ items, onOpenInbox, onOpenItem }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Items shown in the dropdown: most-recent fired + the loudest pending alerts
  // (response-needed bridge first). Cap to 10.
  const recent = useMemo(() => {
    const firedSorted = items
      .filter((i) => i.status === "fired")
      .sort((a, b) =>
        (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt),
      );
    const ephemeral = items.filter(
      (i) => i.status === "pending" && i.kind === "response-needed",
    );
    return [...ephemeral, ...firedSorted].slice(0, 10);
  }, [items]);

  const badgeCount = useMemo(() => {
    return items.filter(
      (i) =>
        i.status === "fired" ||
        (i.status === "pending" && i.kind === "response-needed"),
    ).length;
  }, [items]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const dismiss = useCallback(async (id: string) => {
    await fetch(`/api/inbox/${id}/dismiss`, { method: "POST" });
  }, []);

  const snooze = useCallback(async (id: string) => {
    await fetch(`/api/inbox/${id}/snooze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 10 }),
    });
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative grid h-7 w-7 place-items-center rounded-md border transition-colors ${
          badgeCount > 0
            ? "border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
            : "border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
        title={`${badgeCount} unread`}
      >
        <span aria-hidden>🔔</span>
        {badgeCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-[360px] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">
              Notifications
            </span>
            <button
              onClick={() => {
                setOpen(false);
                onOpenInbox();
              }}
              className="text-[10px] text-purple-300 hover:text-purple-200"
            >
              open inbox →
            </button>
          </div>
          <ul className="max-h-[420px] overflow-y-auto p-2 text-xs">
            {recent.length === 0 ? (
              <li className="px-2 py-6 text-center text-[11px] text-zinc-600">
                No notifications.
              </li>
            ) : null}
            {recent.map((it) => (
              <li
                key={it.id}
                className="mb-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-2"
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm leading-none">
                    {it.kind === "response-needed"
                      ? "💬"
                      : it.kind === "agent"
                      ? "🧙"
                      : "⏰"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-zinc-100">{it.title}</div>
                    {it.body ? (
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-zinc-500">
                        {it.body}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-[9px] text-zinc-600">
                      {it.status === "fired"
                        ? `fired ${relTime(it.firedAt)}`
                        : it.kind === "response-needed"
                        ? "waiting on you"
                        : relTime(it.updatedAt)}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {onOpenItem ? (
                    <BellBtn
                      onClick={() => {
                        setOpen(false);
                        onOpenItem(it);
                      }}
                    >
                      Open
                    </BellBtn>
                  ) : null}
                  {it.kind !== "response-needed" ? (
                    <>
                      <BellBtn onClick={() => void snooze(it.id)}>Snooze 10m</BellBtn>
                      <BellBtn onClick={() => void dismiss(it.id)}>Dismiss</BellBtn>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BellBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
