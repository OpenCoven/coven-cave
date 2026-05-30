"use client";

import { useEffect, useMemo, useState } from "react";
import type { DaemonStatus, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { NotificationBell } from "@/components/notification-bell";

type Props = {
  onDaemonStarted?: () => void;
  sessions?: SessionRow[];
  responseNeededCount?: number;
  onRunningChange?: (running: boolean) => void;
  onOpenOnboarding?: () => void;
  inboxItems?: InboxItem[];
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: InboxItem) => void;
};

export function DaemonBar({
  onDaemonStarted,
  sessions = [],
  responseNeededCount = 0,
  onRunningChange,
  onOpenOnboarding,
  inboxItems = [],
  onOpenInbox,
  onOpenInboxItem,
}: Props) {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      const json = (await res.json()) as DaemonStatus;
      setStatus(json);
      onRunningChange?.(json.running === true);
    } catch {
      setStatus({ running: false, reason: "fetch failed" });
      onRunningChange?.(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const running = sessions.filter((s) => s.status === "running").length;
    return { total: sessions.length, running };
  }, [sessions]);

  const start = async () => {
    setBusy(true);
    try {
      await fetch("/api/daemon/start", { method: "POST" });
      await refresh();
      onDaemonStarted?.();
    } finally {
      setBusy(false);
    }
  };

  const running = status?.running === true;
  const dotClass = running ? "bg-emerald-400" : "bg-zinc-500";
  const label = running ? "daemon running" : "daemon offline";

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight">CovenCave</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <span>{label}</span>
          {running && status?.daemon ? (
            <span className="text-zinc-500">· pid {status.daemon.pid}</span>
          ) : null}
          {!running && status?.reason ? (
            <span className="text-zinc-500">· {status.reason}</span>
          ) : null}
        </div>

        {running ? (
          <div className="flex items-center gap-3 text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono">{stats.running}</span>
              <span className="text-zinc-500">live</span>
            </span>
            <span className="font-mono text-zinc-500">{stats.total} total</span>
            {responseNeededCount > 0 ? (
              <span className="flex items-center gap-1 rounded bg-amber-500/80 px-1.5 py-[1px] font-bold uppercase tracking-widest text-zinc-900">
                {responseNeededCount} reply
              </span>
            ) : null}
          </div>
        ) : null}

        {!running ? (
          <button
            onClick={start}
            disabled={busy}
            className="rounded-md bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
          >
            {busy ? "starting…" : "start daemon"}
          </button>
        ) : (
          <button
            onClick={refresh}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            refresh
          </button>
        )}

        {onOpenInbox ? (
          <NotificationBell
            items={inboxItems}
            onOpenInbox={onOpenInbox}
            onOpenItem={onOpenInboxItem}
          />
        ) : null}

        {onOpenOnboarding ? (
          <button
            onClick={onOpenOnboarding}
            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Open setup"
          >
            setup
          </button>
        ) : null}
      </div>
    </header>
  );
}
