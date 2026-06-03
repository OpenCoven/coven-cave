"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import { Icon } from "@/lib/icon";
import { SnoozeMenu } from "@/components/snooze-menu";

// AutomationsView (issue: automations restructure, June 2026) —
// replaces the old kanban Inbox + thin Schedules pages. Single home
// for every time-driven InboxItem, split into three tabs:
//   • Schedules — recurring items (daily/weekly/interval/cron) with
//     next-fire, last-run, run-now, pause/resume.
//   • Pending   — one-shot reminders waiting to fire.
//   • History   — fired/done/dismissed entries (audit log).
// The dedicated triage page (Inbox) takes over the "Inbox" mode;
// this view absorbs everything that was tracking automation timing.

type Props = {
  familiars: Familiar[];
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  onNewReminder?: () => void;
};

type TabId = "schedules" | "pending" | "history";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
  if (rec.type === "daily") return `daily ${pad(rec.hour)}:${pad(rec.minute)}`;
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => DAY_INITIALS[d] ?? "?").join("/");
    return `${days} ${pad(rec.hour)}:${pad(rec.minute)}`;
  }
  if (rec.type === "cron") return `cron "${rec.expr}"`;
  return "scheduled";
}

function humanRecurrenceLong(rec: Recurrence | undefined): string {
  if (!rec || rec.type === "none") return "one-shot";
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => WEEKDAY[d] ?? "?").join("/");
    return `${days} at ${pad(rec.hour)}:${pad(rec.minute)}`;
  }
  return humanRecurrence(rec);
}

function relTime(iso: string | undefined | null): string {
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

export function AutomationsView({
  familiars,
  onOpenSession,
  onNewReminder,
}: Props) {
  const [tab, setTab] = useState<TabId>("schedules");
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

  const famById = useMemo(() => {
    const m = new Map<string, Familiar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const schedules = useMemo(
    () =>
      items
        .filter(
          (it) =>
            it.recurrence &&
            it.recurrence.type !== "none" &&
            (it.status === "pending" || it.status === "dismissed"),
        )
        .sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [items],
  );

  const pending = useMemo(
    () =>
      items
        .filter(
          (it) =>
            (!it.recurrence || it.recurrence.type === "none") &&
            (it.status === "pending" || it.status === "snoozed"),
        )
        .sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [items],
  );

  const history = useMemo(
    () =>
      items
        .filter(
          (it) =>
            it.status === "fired" ||
            it.status === "done" ||
            (it.status === "dismissed" && (!it.recurrence || it.recurrence.type === "none")),
        )
        .sort((a, b) =>
          (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt),
        ),
    [items],
  );

  const dueSoonCount = useMemo(() => {
    const cutoff = Date.now() + 24 * 3600_000;
    return [...schedules, ...pending].filter((it) => {
      if (it.status === "dismissed") return false;
      if (!it.fireAt) return false;
      const t = new Date(it.fireAt).getTime();
      return t > Date.now() && t <= cutoff;
    }).length;
  }, [schedules, pending]);

  const patchItem = useCallback(
    async (id: string, body: object) => {
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/inbox/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "patch failed");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const actItem = useCallback(
    async (id: string, path: string, body?: object) => {
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/inbox/${id}/${path}`, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "action failed");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const removeItem = useCallback(
    async (id: string) => {
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/inbox/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`http ${res.status}`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "delete failed");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const runNow = (id: string) =>
    patchItem(id, { fireAt: new Date().toISOString(), status: "pending" });

  const togglePaused = (item: InboxItem) =>
    patchItem(item.id, {
      status: item.status === "dismissed" ? "pending" : "dismissed",
    });

  const stopRecurrence = (id: string) =>
    patchItem(id, { recurrence: { type: "none" } });

  const familiarLabel = (fid?: string | null) => {
    if (!fid) return null;
    return famById.get(fid)?.display_name ?? fid;
  };

  const initial = (fid?: string | null) => {
    const f = fid ? famById.get(fid) : null;
    return (f?.display_name ?? "?").slice(0, 1).toUpperCase();
  };

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "schedules", label: "Schedules", count: schedules.length },
    { id: "pending", label: "Pending", count: pending.length },
    { id: "history", label: "History", count: history.length },
  ];

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)]">
      <header className="border-b border-[var(--border-hairline)] px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-sm font-medium text-[var(--text-primary)]">
              Automations
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              Reminders, schedules, and recurring familiar tasks. {dueSoonCount}{" "}
              firing in the next 24h.
            </p>
          </div>
          {onNewReminder ? (
            <button
              type="button"
              onClick={onNewReminder}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]/80"
            >
              <Icon name="ph:plus" width={11} />
              New automation
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors " +
                  (active
                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-secondary)]")
                }
              >
                <span>{t.label}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-px text-[9px] tabular-nums " +
                    (active
                      ? "bg-[var(--bg-base)] text-[var(--text-secondary)]"
                      : "bg-[var(--bg-raised)]/60 text-[var(--text-muted)]")
                  }
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {error ? (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl">
          {tab === "schedules" ? (
            <SchedulesPanel
              items={schedules}
              busyId={busyId}
              initial={initial}
              familiarLabel={familiarLabel}
              runNow={runNow}
              togglePaused={togglePaused}
              stopRecurrence={stopRecurrence}
              removeItem={removeItem}
            />
          ) : tab === "pending" ? (
            <PendingPanel
              items={pending}
              busyId={busyId}
              initial={initial}
              familiarLabel={familiarLabel}
              actItem={actItem}
              runNow={runNow}
              removeItem={removeItem}
            />
          ) : (
            <HistoryPanel
              items={history}
              busyId={busyId}
              initial={initial}
              familiarLabel={familiarLabel}
              onOpenSession={onOpenSession}
              actItem={actItem}
              removeItem={removeItem}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-full bg-[var(--accent-presence)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-presence-soft)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function FamiliarDot({ letter, title }: { letter: string; title?: string }) {
  return (
    <div
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold uppercase"
      style={{
        background: "var(--bg-raised)",
        color: "var(--text-secondary)",
      }}
      title={title}
    >
      {letter}
    </div>
  );
}

type SchedulesPanelProps = {
  items: InboxItem[];
  busyId: string | null;
  initial: (fid?: string | null) => string;
  familiarLabel: (fid?: string | null) => string | null;
  runNow: (id: string) => Promise<void> | void;
  togglePaused: (item: InboxItem) => Promise<void> | void;
  stopRecurrence: (id: string) => Promise<void> | void;
  removeItem: (id: string) => Promise<void> | void;
};

function SchedulesPanel({
  items,
  busyId,
  initial,
  familiarLabel,
  runNow,
  togglePaused,
  stopRecurrence,
  removeItem,
}: SchedulesPanelProps) {
  if (items.length === 0) {
    return (
      <Empty>
        No recurring schedules yet. Create one from the Pending tab or a
        familiar&apos;s chat.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-[var(--border-hairline)]">
      {items.map((it) => {
        const paused = it.status === "dismissed";
        return (
          <li key={it.id} className="py-3">
            <div className="flex items-center gap-3">
              <FamiliarDot
                letter={initial(it.familiarId)}
                title={familiarLabel(it.familiarId) ?? "unbound"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium text-[var(--text-primary)]">
                    {it.title}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {humanRecurrenceLong(it.recurrence)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-3 text-[11px] text-[var(--text-muted)]">
                  <span title={it.fireAt ?? undefined}>
                    next {relTime(it.fireAt)}
                  </span>
                  <span title={it.firedAt ?? undefined}>
                    last{" "}
                    {it.firedAt ? (
                      <span className="text-emerald-300">
                        {relTime(it.firedAt)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                  {paused ? (
                    <span className="rounded bg-[var(--bg-raised)] px-1 text-[var(--text-secondary)]">
                      paused
                    </span>
                  ) : null}
                  {familiarLabel(it.familiarId) ? (
                    <span className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-1 text-[var(--text-secondary)]">
                      {familiarLabel(it.familiarId)}
                    </span>
                  ) : null}
                </div>
              </div>
              <PrimaryBtn
                disabled={busyId === it.id || paused}
                onClick={() => runNow(it.id)}
                title="Trigger this automation now"
              >
                Run now
              </PrimaryBtn>
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => togglePaused(it)}
                title={paused ? "Resume schedule" : "Pause schedule"}
              >
                {paused ? "Resume" : "Pause"}
              </GhostBtn>
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => stopRecurrence(it.id)}
                title="Convert to one-shot — stop re-spawning"
              >
                Stop repeat
              </GhostBtn>
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => removeItem(it.id)}
                title="Delete this automation"
              >
                <Icon name="ph:trash" width={12} />
              </GhostBtn>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type PendingPanelProps = {
  items: InboxItem[];
  busyId: string | null;
  initial: (fid?: string | null) => string;
  familiarLabel: (fid?: string | null) => string | null;
  actItem: (id: string, path: string, body?: object) => Promise<void> | void;
  runNow: (id: string) => Promise<void> | void;
  removeItem: (id: string) => Promise<void> | void;
};

function PendingPanel({
  items,
  busyId,
  initial,
  familiarLabel,
  actItem,
  runNow,
  removeItem,
}: PendingPanelProps) {
  if (items.length === 0) {
    return (
      <Empty>
        No one-shot reminders waiting. Use{" "}
        <span className="rounded bg-[var(--bg-raised)] px-1 text-[var(--text-primary)]">
          /remind
        </span>{" "}
        to add one.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-[var(--border-hairline)]">
      {items.map((it) => {
        const isSnoozed = it.status === "snoozed";
        return (
          <li key={it.id} className="py-3">
            <div className="flex items-center gap-3">
              <FamiliarDot
                letter={initial(it.familiarId)}
                title={familiarLabel(it.familiarId) ?? "unbound"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium text-[var(--text-primary)]">
                    {it.title}
                  </span>
                  {isSnoozed ? (
                    <span className="shrink-0 rounded bg-[var(--bg-raised)] px-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                      snoozed
                    </span>
                  ) : null}
                </div>
                {it.body ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                    {it.body}
                  </p>
                ) : null}
                <div className="mt-0.5 flex flex-wrap items-baseline gap-3 text-[11px] text-[var(--text-muted)]">
                  <span
                    className="inline-flex items-center gap-1"
                    title={it.fireAt ?? undefined}
                  >
                    <Icon name="ph:alarm-bold" width={11} />
                    fires {relTime(it.fireAt)}
                  </span>
                  {familiarLabel(it.familiarId) ? (
                    <span className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-1 text-[var(--text-secondary)]">
                      {familiarLabel(it.familiarId)}
                    </span>
                  ) : null}
                </div>
              </div>
              <PrimaryBtn
                disabled={busyId === it.id}
                onClick={() => runNow(it.id)}
                title="Fire now"
              >
                Run now
              </PrimaryBtn>
              <SnoozeMenu
                size="xs"
                onSnooze={(untilIso) => actItem(it.id, "snooze", { untilIso })}
              />
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => actItem(it.id, "dismiss")}
                title="Dismiss"
              >
                Dismiss
              </GhostBtn>
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => removeItem(it.id)}
                title="Delete"
              >
                <Icon name="ph:trash" width={12} />
              </GhostBtn>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type HistoryPanelProps = {
  items: InboxItem[];
  busyId: string | null;
  initial: (fid?: string | null) => string;
  familiarLabel: (fid?: string | null) => string | null;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  actItem: (id: string, path: string, body?: object) => Promise<void> | void;
  removeItem: (id: string) => Promise<void> | void;
};

function HistoryPanel({
  items,
  busyId,
  initial,
  familiarLabel,
  onOpenSession,
  actItem,
  removeItem,
}: HistoryPanelProps) {
  if (items.length === 0) {
    return <Empty>No fired automations yet.</Empty>;
  }
  return (
    <ul className="divide-y divide-[var(--border-hairline)]">
      {items.map((it) => {
        const isFired = it.status === "fired";
        const isDismissed = it.status === "dismissed";
        const ts = it.firedAt ?? it.updatedAt;
        return (
          <li key={it.id} className="py-3">
            <div className="flex items-center gap-3">
              <FamiliarDot
                letter={initial(it.familiarId)}
                title={familiarLabel(it.familiarId) ?? "unbound"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[var(--text-primary)]">
                    {it.title}
                  </span>
                  <StatusBadge status={it.status} />
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-3 text-[11px] text-[var(--text-muted)]">
                  <span title={ts}>
                    {isFired ? "fired" : isDismissed ? "dismissed" : "done"}{" "}
                    {relTime(ts)}
                  </span>
                  {familiarLabel(it.familiarId) ? (
                    <span className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-1 text-[var(--text-secondary)]">
                      {familiarLabel(it.familiarId)}
                    </span>
                  ) : null}
                </div>
              </div>
              {isFired ? (
                <GhostBtn
                  disabled={busyId === it.id}
                  onClick={() => actItem(it.id, "done")}
                  title="Mark done"
                >
                  Mark done
                </GhostBtn>
              ) : null}
              {it.sessionId && onOpenSession ? (
                <GhostBtn
                  disabled={busyId === it.id}
                  onClick={() =>
                    onOpenSession(it.sessionId!, it.familiarId ?? null)
                  }
                  title="Open the session this fired into"
                >
                  Open session
                </GhostBtn>
              ) : null}
              <GhostBtn
                disabled={busyId === it.id}
                onClick={() => removeItem(it.id)}
                title="Delete from history"
              >
                <Icon name="ph:trash" width={12} />
              </GhostBtn>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ status }: { status: InboxItem["status"] }) {
  const map: Record<InboxItem["status"], { label: string; cls: string }> = {
    pending: { label: "pending", cls: "text-[var(--text-muted)]" },
    snoozed: { label: "snoozed", cls: "text-[var(--text-muted)]" },
    fired: { label: "fired", cls: "text-emerald-300" },
    done: { label: "done", cls: "text-[var(--text-muted)]" },
    dismissed: { label: "dismissed", cls: "text-[var(--text-muted)]" },
  };
  const m = map[status] ?? { label: status, cls: "text-[var(--text-muted)]" };
  return (
    <span
      className={
        "shrink-0 rounded bg-[var(--bg-raised)] px-1 text-[10px] uppercase tracking-wider " +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}
