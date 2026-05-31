"use client";

import { useCallback, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem, ItemStatus } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import { SnoozeMenu } from "@/components/snooze-menu";
import { Icon } from "@/lib/icon";

const DAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function describeRecurrence(rec: Recurrence | undefined): string | null {
  if (!rec || rec.type === "none") return null;
  if (rec.type === "interval") {
    const ms = rec.everyMs;
    if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) return `every ${Math.round(ms / 3_600_000)}h`;
    return `every ${Math.round(ms / 86_400_000)}d`;
  }
  if (rec.type === "daily") {
    return `daily ${String(rec.hour).padStart(2, "0")}:${String(rec.minute).padStart(2, "0")}`;
  }
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => DAY_INITIALS[d] ?? "?").join("/");
    return `${days} ${String(rec.hour).padStart(2, "0")}:${String(rec.minute).padStart(2, "0")}`;
  }
  if (rec.type === "cron") {
    return `cron: ${rec.expr}`;
  }
  return null;
}

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  onRefresh: () => void;
  onNewReminder: () => void;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

const COLUMNS: { id: ItemStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "fired", label: "Fired" },
  { id: "done", label: "Done" },
];

function fmtFireAt(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(abs / 3_600_000);
  if (hrs < 24) return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function InboxView({
  items,
  familiars,
  onRefresh,
  onNewReminder,
  onOpenSession,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<ItemStatus, InboxItem[]>();
    for (const col of COLUMNS) m.set(col.id, []);
    for (const it of items) {
      // Snoozed items render in pending column (they're scheduled-future).
      const bucket = it.status === "snoozed" ? "pending" : it.status;
      if (!m.has(bucket as ItemStatus)) continue;
      m.get(bucket as ItemStatus)?.push(it);
    }
    // Sort: pending by fireAt asc, fired by firedAt desc, done by updatedAt desc.
    m.get("pending")?.sort(
      (a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? ""),
    );
    m.get("fired")?.sort((a, b) =>
      (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt),
    );
    m.get("done")?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return m;
  }, [items]);

  const act = useCallback(
    async (id: string, path: string, body?: object) => {
      // Ephemeral rows (response-needed bridge) aren't persisted — no API.
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        await fetch(`/api/inbox/${id}/${path}`, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        onRefresh();
      } finally {
        setBusyId(null);
      }
    },
    [onRefresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        await fetch(`/api/inbox/${id}`, { method: "DELETE" });
        onRefresh();
      } finally {
        setBusyId(null);
      }
    },
    [onRefresh],
  );

  // PATCH the root inbox item — used for stop-recurrence, which sets
  // recurrence.type to "none" so the next fire stops spawning a sibling.
  const patch = useCallback(
    async (id: string, body: object) => {
      if (id.startsWith("eph:")) return;
      setBusyId(id);
      try {
        await fetch(`/api/inbox/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        onRefresh();
      } finally {
        setBusyId(null);
      }
    },
    [onRefresh],
  );

  const familiarLabel = (fid: string | null | undefined) => {
    if (!fid) return null;
    const f = familiars.find((x) => x.id === fid);
    return f?.display_name ?? fid;
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold text-foreground">Inbox</h1>
          <span className="text-[11px] text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          onClick={onNewReminder}
          className="rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          + New reminder
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => {
          const colItems = grouped.get(col.id) ?? [];
          return (
            <section
              key={col.id}
              className="flex w-80 shrink-0 flex-col rounded-xl border border-border bg-card"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span>{col.label}</span>
                <span>{colItems.length}</span>
              </div>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {colItems.length === 0 ? (
                  <li className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                    Empty.
                  </li>
                ) : null}
                {colItems.map((it) => (
                  <li
                    key={it.id}
                    className="rounded-lg border border-border bg-background p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex-1 truncate text-sm text-foreground">
                        {it.title}
                      </span>
                      <KindBadge kind={it.kind} source={it.source} />
                    </div>
                    {it.body ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {it.body}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {col.id === "pending" ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="ph:alarm-bold" />
                          {fmtFireAt(it.fireAt)}
                        </span>
                      ) : col.id === "fired" ? (
                        <span>fired {fmtFireAt(it.firedAt)}</span>
                      ) : (
                        <span>done {fmtFireAt(it.updatedAt)}</span>
                      )}
                      {describeRecurrence(it.recurrence) ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-border bg-card px-1 py-px"
                          title="Repeats — use Stop recurrence to break the chain"
                        >
                          <Icon name="ph:arrows-clockwise-bold" />
                          {describeRecurrence(it.recurrence)}
                        </span>
                      ) : null}
                      {familiarLabel(it.familiarId) ? (
                        <span className="rounded border border-border bg-card px-1 py-px">
                          {familiarLabel(it.familiarId)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {col.id === "pending" ? (
                        <>
                          <SnoozeMenu
                            size="xs"
                            onSnooze={(untilIso) =>
                              act(it.id, "snooze", { untilIso })
                            }
                          />
                          <Btn
                            disabled={busyId === it.id}
                            onClick={() => act(it.id, "dismiss")}
                          >
                            Dismiss
                          </Btn>
                          {describeRecurrence(it.recurrence) ? (
                            <Btn
                              disabled={busyId === it.id}
                              onClick={() =>
                                patch(it.id, { recurrence: { type: "none" } })
                              }
                              title="Stop this reminder from re-spawning after it fires"
                            >
                              Stop recurrence
                            </Btn>
                          ) : null}
                        </>
                      ) : null}
                      {col.id === "fired" ? (
                        <>
                          <Btn
                            disabled={busyId === it.id}
                            onClick={() => act(it.id, "done")}
                          >
                            Done
                          </Btn>
                          <SnoozeMenu
                            size="xs"
                            onSnooze={(untilIso) =>
                              act(it.id, "snooze", { untilIso })
                            }
                          />
                          <Btn
                            disabled={busyId === it.id}
                            onClick={() => act(it.id, "dismiss")}
                          >
                            Dismiss
                          </Btn>
                          {it.sessionId && onOpenSession ? (
                            <Btn
                              disabled={busyId === it.id}
                              onClick={() =>
                                onOpenSession(it.sessionId!, it.familiarId ?? null)
                              }
                            >
                              Open session
                            </Btn>
                          ) : null}
                        </>
                      ) : null}
                      {col.id === "done" ? (
                        <Btn
                          disabled={busyId === it.id}
                          onClick={() => remove(it.id)}
                        >
                          Delete
                        </Btn>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Btn({
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
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border border-border bg-card px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function KindBadge({
  kind,
  source,
}: {
  kind: InboxItem["kind"];
  source: InboxItem["source"];
}) {
  const label =
    kind === "reminder"
      ? "remind"
      : kind === "agent"
      ? source === "agent"
        ? "agent"
        : "event"
      : "needs you";
  return (
    <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
  );
}
