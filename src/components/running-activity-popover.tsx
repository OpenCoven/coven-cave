"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  fetchRunningActivity,
  type RunningActivityItem,
  type RunningActivityKind,
  type RunningActivitySourceId,
} from "@/lib/running-activity";
import type { Familiar } from "@/lib/types";

const KIND_ICON: Record<RunningActivityKind, IconName> = {
  session: "ph:chat-circle-dots",
  "board-task": "ph:kanban",
  automation: "ph:clock",
  flow: "ph:flow-arrow",
  workflow: "ph:tree-structure",
};

const KIND_LABEL: Record<RunningActivityKind, string> = {
  session: "Chat",
  "board-task": "Task",
  automation: "Ritual",
  flow: "Flow",
  workflow: "Workflow",
};

const SOURCE_LABEL: Record<RunningActivitySourceId, string> = {
  sessions: "chats",
  board: "board tasks",
  automations: "rituals",
  flows: "flows",
  workflows: "workflows",
};

function fmtBadge(n: number): string {
  // Cap at 9+ like every other corner badge in the bar — the trigger's
  // aria-label still carries the exact count.
  return n > 9 ? "9+" : String(n);
}

type ItemProps = {
  item: RunningActivityItem;
  familiars: Familiar[];
  onOpen: (item: RunningActivityItem) => void;
};

function ActivityRow({ item, familiars, onOpen }: ItemProps) {
  const familiar = item.familiarId
    ? familiars.find((f) => f.id === item.familiarId)?.display_name ?? null
    : null;
  const meta = [KIND_LABEL[item.kind], familiar].filter(Boolean).join(" · ");
  const queued = item.status === "queued";
  return (
    <li>
      <button
        type="button"
        className="running-activity__row focus-ring flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
        onClick={() => onOpen(item)}
        aria-label={`${KIND_LABEL[item.kind]}${queued ? " queued" : ""}: ${item.title}`}
        title={item.title}
      >
        <Icon
          name={KIND_ICON[item.kind]}
          width={14}
          height={14}
          aria-hidden
          className="mt-0.5 flex-shrink-0 text-[var(--text-muted)]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className={`mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                queued ? "bg-[var(--color-warning)]" : "animate-pulse bg-[var(--color-success)]"
              }`}
            />
            <span className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {item.title}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            {meta} · started{" "}
            <RelativeTime iso={item.startedAt} fallback="—" />
          </span>
        </span>
      </button>
    </li>
  );
}

type ListProps = {
  items: RunningActivityItem[];
  unavailable: RunningActivitySourceId[];
  familiars: Familiar[];
  onOpen: (item: RunningActivityItem) => void;
  onViewAll: () => void;
};

/** Presentational list — exported so tests render the exact markup the user sees. */
export function RunningActivityList({
  items,
  unavailable,
  familiars,
  onOpen,
  onViewAll,
}: ListProps) {
  useMinuteTick();
  return (
    <div className="flex min-h-0 flex-col">
      <ul className="running-activity__list max-h-64 overflow-y-auto p-1">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} familiars={familiars} onOpen={onOpen} />
        ))}
        {items.length === 0 ? (
          <li className="px-2 py-3 text-center text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            Nothing running right now
          </li>
        ) : null}
      </ul>
      {unavailable.length > 0 ? (
        <p className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          Some activity unavailable: {unavailable.map((id) => SOURCE_LABEL[id]).join(", ")}
        </p>
      ) : null}
      <div className="border-t border-[var(--border-hairline)] p-1">
        <button
          type="button"
          className="running-activity__view-all focus-ring flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence)] transition-colors hover:bg-[var(--bg-hover)]"
          onClick={onViewAll}
        >
          View all activity
          <Icon name="ph:arrow-right" width={12} height={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

type Props = {
  /** Familiars for display-name resolution on session/task rows. */
  familiars: Familiar[];
  /** Navigate to the item's owning surface (session, card, ritual, flow, workflow). */
  onOpenItem: (item: RunningActivityItem) => void;
  /** Open the closest existing activity surface (no Activity Center exists). */
  onViewAll: () => void;
  /** Poll cadence for the always-mounted count trigger. Tests inject a faster one. */
  pollIntervalMs?: number;
};

/**
 * The desktop menu bar's running-activity control, replacing the old
 * running-processes pill (cave-21rp). It aggregates chats, Board tasks, ritual
 * runs, Flow runs and Workflow runs behind GET /api/running-activity and lists
 * them — deduplicating task-backed sessions — with direct navigation per row
 * and a "View all" escape hatch. Hidden at zero unless a source is unavailable.
 */
export function RunningActivityPopover({
  familiars,
  onOpenItem,
  onViewAll,
  pollIntervalMs = 8000,
}: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RunningActivityItem[]>([]);
  const [unavailable, setUnavailable] = useState<RunningActivitySourceId[]>([]);
  const [total, setTotal] = useState(0);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    void fetchRunningActivity().then((payload) => {
      if (!payload) return;
      setItems(payload.items);
      setUnavailable(payload.unavailable);
      setTotal(payload.total);
    });
  }, []);

  // Mount load + the same pausable poll discipline the workspace's other chrome
  // polls use; the on-return refresh comes free from usePausablePoll.
  useEffect(() => {
    load();
  }, [load]);
  usePausablePoll(load, pollIntervalMs);

  // Trap focus while the popover is open: Escape closes, Tab cycles inside,
  // closing restores focus to the trigger. Same pattern as NotificationBell.
  useFocusTrap(open, popoverRef, { onEscape: () => setOpen(false) });

  // Refresh on open so the list is fresh the moment the human looks, and close
  // on outside click.
  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, load]);

  const rows = useMemo(
    () => [...items].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [items],
  );
  // Hidden at zero — except when a source is unavailable, so a degraded source
  // still surfaces rather than silently vanishing.
  if (total === 0 && unavailable.length === 0) return null;

  const label = `${total} running ${total === 1 ? "item" : "items"}`;
  return (
    <span ref={wrapRef} className="running-activity relative">
      <button
        type="button"
        className="menu-bar__status focus-ring"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — show activity`}
        title={`${label} — click to view`}
      >
        <Icon name="ph:waveform" width={22} height={22} aria-hidden />
        {total > 0 ? (
          <span className="menu-bar__badge" aria-hidden>
            {fmtBadge(total)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="true"
          aria-label="Running activity"
          tabIndex={-1}
          className="running-activity__popover glass-overlay absolute right-0 top-full z-50 mt-1 w-[360px] rounded-xl border border-[var(--border-strong)] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
            <span className="text-[length:var(--text-xs)] font-medium text-[var(--text-primary)]">
              Running activity
            </span>
            <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{label}</span>
          </div>
          <RunningActivityList
            items={rows}
            unavailable={unavailable}
            familiars={familiars}
            onOpen={(item) => {
              setOpen(false);
              onOpenItem(item);
            }}
            onViewAll={() => {
              setOpen(false);
              onViewAll();
            }}
          />
        </div>
      ) : null}
    </span>
  );
}
