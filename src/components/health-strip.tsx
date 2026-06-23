"use client";

import { useEffect, useRef, useState } from "react";
import { relativeTime } from "@/lib/relative-time";
import { useDateTimePrefs } from "@/lib/datetime-format";
import type { Familiar } from "@/lib/types";

type DaemonHealth = {
  running: boolean;
  reason?: string;
  apiVersion?: string;
  covenVersion?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

type SessionLite = {
  id: string;
  title: string;
  status: string;
  harness: string;
  familiarId: string | null;
  updated_at: string;
};

type DotState = "healthy" | "degraded" | "offline" | "unknown";

type Dot = {
  key: string;
  label: string;
  state: DotState;
  lastSeen?: string;
  detail?: string;
};

const DAEMON_POLL_MS = 3000;
const SESSIONS_POLL_MS = 5000;
const DEGRADE_MS = 15000;
const OFFLINE_MS = 45000;

function classifyAge(updatedAt: string | undefined, sessionStatus?: string): DotState {
  if (!updatedAt) return "unknown";
  if (sessionStatus === "failed" || sessionStatus === "errored") return "offline";
  const age = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(age)) return "unknown";
  if (age < DEGRADE_MS) return "healthy";
  if (age < OFFLINE_MS) return "degraded";
  return "offline";
}

function dotColor(state: DotState): string {
  switch (state) {
    case "healthy":
      return "var(--accent-presence)";
    case "degraded":
      return "var(--color-warning)";
    case "offline":
      return "var(--color-danger)";
    case "unknown":
    default:
      return "var(--text-muted)";
  }
}

function relTime(iso: string): string {
  return relativeTime(iso);
}

export function HealthStrip({ familiars }: { familiars: Familiar[] }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [daemon, setDaemon] = useState<DaemonHealth | null>(null);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as DaemonHealth;
        if (!cancelled) setDaemon(json);
      } catch {
        if (!cancelled) setDaemon({ running: false, reason: "unreachable" });
      }
    };
    void tick();
    const t = setInterval(tick, DAEMON_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/sessions/list", { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; sessions?: SessionLite[] };
        if (!cancelled) setSessions(json.sessions ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      }
    };
    void tick();
    const t = setInterval(tick, SESSIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const dots: Dot[] = [];

  dots.push({
    key: "coven",
    label: "coven",
    state: daemon?.running ? "healthy" : daemon === null ? "unknown" : "offline",
    lastSeen: daemon?.daemon?.startedAt,
    detail: daemon?.running
      ? `pid ${daemon.daemon?.pid ?? "?"} · v${daemon.covenVersion ?? "?"}`
      : daemon?.reason ?? "unreachable",
  });

  const ACTIVE = new Set(["running", "idle", "created", "awaiting_input"]);
  const active = sessions.filter((s) => ACTIVE.has(s.status));
  const MAX_VISIBLE = 8;
  const visible = active.slice(0, MAX_VISIBLE);
  for (const s of visible) {
    const fam = familiars.find((f) => f.id === s.familiarId);
    const label = fam?.name ?? s.title ?? s.id.slice(0, 8);
    dots.push({
      key: `s:${s.id}`,
      label,
      state: classifyAge(s.updated_at, s.status),
      lastSeen: s.updated_at,
      detail: `${s.harness} · ${s.status}`,
    });
  }
  const overflow = active.length - visible.length;

  if (active.length === 0 && daemon?.running) {
    dots.push({
      key: "no-sessions",
      label: "no sessions",
      state: "unknown",
      detail: "no familiar sessions running",
    });
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {dots.map((d) => {
        const isOpen = open === d.key;
        return (
          <button
            key={d.key}
            type="button"
            title={`${d.label} · ${d.state}`}
            onClick={() => setOpen(isOpen ? null : d.key)}
            className="focus-ring group relative inline-flex h-3 w-3 items-center justify-center rounded-full transition-transform hover:scale-125"
            style={{
              backgroundColor: dotColor(d.state),
              boxShadow:
                d.state === "healthy"
                  ? `0 0 0 1px color-mix(in oklch, var(--accent-presence) 25%, transparent), 0 0 6px color-mix(in oklch, var(--accent-presence) 45%, transparent)`
                  : `0 0 0 1px var(--border-hairline)`,
            }}
            aria-label={`${d.label} health: ${d.state}`}
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className="ml-1 inline-flex h-4 items-center rounded-full bg-[var(--bg-raised)] px-1.5 text-[10px] text-[var(--text-muted)] tabular-nums shadow-[0_0_0_1px_var(--border-hairline)]"
          title={`${overflow} more session${overflow === 1 ? "" : "s"}`}
        >
          +{overflow}
        </span>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-5 z-50 min-w-[220px] rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2.5 text-[11px] text-[var(--text-primary)] shadow-lg">
          {(() => {
            const d = dots.find((x) => x.key === open);
            if (!d) return null;
            return (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: dotColor(d.state) }}
                  />
                  <span className="font-medium">{d.label}</span>
                  <span className="ml-auto text-[var(--text-muted)]">{d.state}</span>
                </div>
                {d.detail ? (
                  <div className="text-[var(--text-secondary)]">{d.detail}</div>
                ) : null}
                {d.lastSeen ? (
                  <div className="text-[var(--text-muted)]">
                    last seen {relTime(d.lastSeen)}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
