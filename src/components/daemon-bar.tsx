"use client";

import { useEffect, useState } from "react";
import type { DaemonStatus } from "@/lib/types";

type Props = { onDaemonStarted?: () => void };

export function DaemonBar({ onDaemonStarted }: Props) {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      const json = (await res.json()) as DaemonStatus;
      setStatus(json);
    } catch {
      setStatus({ running: false, reason: "fetch failed" });
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

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
        <span className="text-sm">🪄</span>
        <span className="font-semibold tracking-tight">CovenBoard</span>
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

        {!running ? (
          <button
            onClick={start}
            disabled={busy}
            className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
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
      </div>
    </header>
  );
}
