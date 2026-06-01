"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";

// Schedules view (issue #20) — surfaces every recurring inbox item as
// an editable schedule with relative-time next-fire, last-run status,
// and Run-now / enable-disable controls.

type Props = {
  familiars: Familiar[];
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function humanRecurrence(rec: Recurrence | undefined): string {
  if (!rec || rec.type === "none") return "one-shot";
  if (rec.type === "interval") {
    const m = Math.round(rec.everyMs / 60000);
    if (m < 60) return `every ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `every ${h}h`;
    return `every ${Math.round(h / 24)}d`;
  }
  if (rec.type === "daily") return `daily at ${pad(rec.hour)}:${pad(rec.minute)}`;
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => WEEKDAY[d] ?? "?").join("/");
    return `${days} at ${pad(rec.hour)}:${pad(rec.minute)}`;
  }
  if (rec.type === "cron") return `cron "${rec.expr}"`;
  return "scheduled";
}

function relTime(iso: string | undefined): string {
  if (!iso) return "—";
  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);
  const m = Math.round(abs / 60000);
  if (m < 1) return delta > 0 ? "soon" : "just now";
  if (m < 60) return delta > 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return delta > 0 ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  return delta > 0 ? `in ${d}d` : `${d}d ago`;
}

export function SchedulesView({ familiars }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "load failed");
        return;
      }
      setItems(json.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const schedules = useMemo(
    () =>
      items
        .filter((it) => it.recurrence && it.recurrence.type !== "none")
        .sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [items],
  );

  const famById = useMemo(() => {
    const m = new Map<string, Familiar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const runNow = async (id: string) => {
    setBusyId(id);
    try {
      const now = new Date().toISOString();
      const res = await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fireAt: now, status: "pending" }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "run-now failed");
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (item: InboxItem) => {
    setBusyId(item.id);
    try {
      const willDisable = item.status !== "dismissed";
      const res = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: willDisable ? "dismissed" : "pending" }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "toggle failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)]">
      <header className="border-b border-[var(--border-hairline)] px-5 py-3">
        <h1 className="text-sm font-medium text-[var(--text-primary)]">Schedules</h1>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Every recurring item, with next fire and last run.
        </p>
      </header>

      {error ? (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl">
          {schedules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
              No recurring schedules yet. Create one from the Inbox or a familiar&apos;s chat.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-hairline)]">
              {schedules.map((it) => {
                const fam = it.familiarId ? famById.get(it.familiarId) : null;
                const disabled = it.status === "dismissed";
                const lastFired = it.firedAt ?? undefined;
                return (
                  <li key={it.id} className="py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold uppercase"
                        style={{ background: "var(--bg-raised)", color: "var(--text-secondary)" }}
                        title={fam?.display_name ?? "unbound"}
                      >
                        {(fam?.display_name ?? "?").slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate font-medium text-[var(--text-primary)]">
                            {it.title}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            {humanRecurrence(it.recurrence)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-3 text-[11px] text-[var(--text-muted)]">
                          <span title={it.fireAt ?? undefined}>
                            next {relTime(it.fireAt ?? undefined)}
                          </span>
                          <span title={lastFired}>
                            last{" "}
                            {lastFired ? (
                              <span className="text-emerald-300">{relTime(lastFired)}</span>
                            ) : (
                              "—"
                            )}
                          </span>
                          {disabled ? (
                            <span className="rounded bg-[var(--bg-raised)] px-1 text-[var(--text-secondary)]">
                              disabled
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === it.id || disabled}
                        onClick={() => runNow(it.id)}
                        className="rounded-full bg-[var(--accent-presence)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-presence-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        disabled={busyId === it.id}
                        onClick={() => toggleEnabled(it)}
                        className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disabled ? "Enable" : "Disable"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
