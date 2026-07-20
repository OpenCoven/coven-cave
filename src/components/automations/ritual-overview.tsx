"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/automations/status-icon";
import type { InboxItem } from "@/lib/cave-inbox";
import { repoFromGithubSubTag } from "@/lib/github-sub-tags";
import type { IconName } from "@/lib/icon";
import { inboxKindLabel } from "@/lib/inbox-feed";
import { relativeTimeSigned } from "@/lib/relative-time";

export type RitualOverviewPane = "log" | "agenda";

export function ritualWeekLabel(days: Array<{ date: Date }>): string {
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  if (!first || !last) return "";
  const month = new Intl.DateTimeFormat(undefined, { month: "short" });
  return first.getMonth() === last.getMonth()
    ? `${month.format(first)} ${first.getDate()}–${last.getDate()}`
    : `${month.format(first)} ${first.getDate()} – ${month.format(last)} ${last.getDate()}`;
}

export function useRitualNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const scheduleMidnight = () => {
      const current = new Date();
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = window.setTimeout(() => {
        setNow(new Date());
        scheduleMidnight();
      }, Math.max(1_000, next.getTime() - current.getTime() + 250));
    };
    setNow(new Date());
    scheduleMidnight();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return now;
}

function ritualItemDate(item: InboxItem): Date | null {
  const iso = item.fireAt ?? item.firedAt ?? item.updatedAt;
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

function RitualAction({ icon, label, text, onClick }: { icon: IconName; label: string; text: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)] [color:var(--text-secondary)]!"
      leadingIcon={icon}
    >
      <span className="@max-[520px]:hidden">{text}</span>
    </Button>
  );
}

function RitualActions({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-0.5 pl-1">{children}</span>;
}

export function RitualItemRow({ item, familiarLabel, onSelect, quiet = false }: { item: InboxItem; familiarLabel: (familiarId?: string | null) => string | null; onSelect: (item: InboxItem) => void; quiet?: boolean }) {
  const familiar = familiarLabel(item.familiarId);
  const date = ritualItemDate(item);
  return (
    <button type="button" className={`rituals-overview__row focus-ring-inset${quiet ? " rituals-overview__row--quiet" : ""}`} onClick={() => onSelect(item)}>
      <StatusIcon item={item} />
      <span className="rituals-overview__row-title">{item.title}</span>
      <span className="rituals-overview__kind">{inboxKindLabel(item.kind)}</span>
      {familiar ? <span className="rituals-overview__meta">{familiar}</span> : null}
      <span className="rituals-overview__spacer" />
      <span className="rituals-overview__meta">{date ? relativeTime(date.toISOString()) : relativeTime(item.updatedAt)}</span>
    </button>
  );
}

export function RitualNeedsRow({ item, familiarLabel, onSelect, onDone, onSnooze, onDismiss, onUnwatch }: { item: InboxItem; familiarLabel: (familiarId?: string | null) => string | null; onSelect: (item: InboxItem) => void; onDone: (item: InboxItem) => void; onSnooze: (item: InboxItem) => void; onDismiss: (item: InboxItem) => void; onUnwatch?: (item: InboxItem, repo: string) => void }) {
  const familiar = familiarLabel(item.familiarId);
  const watchedRepo = repoFromGithubSubTag(item.auto);
  return (
    <li className="rituals-overview__need-row">
      <button type="button" className="rituals-overview__need-main focus-ring-inset" onClick={() => onSelect(item)}>
        <span aria-hidden className="rituals-overview__live-dot" />
        <span className="rituals-overview__row-title">{item.title}</span>
        {familiar ? <span className="rituals-overview__meta">{familiar}</span> : null}
        <span className="rituals-overview__meta">{item.firedAt ? relativeTime(item.firedAt) : relativeTime(item.updatedAt)}</span>
      </button>
      <RitualActions>
        <RitualAction icon="ph:check-bold" label={`Mark ${item.title} done`} text="Done" onClick={() => onDone(item)} />
        {item.status === "fired" ? <RitualAction icon="ph:clock-countdown" label={`Snooze ${item.title} for 1 hour`} text="Snooze" onClick={() => onSnooze(item)} /> : null}
        {onUnwatch && watchedRepo ? <RitualAction icon="ph:bell-slash" label={`Unwatch ${watchedRepo} — stop GitHub notifications from it`} text="Unwatch" onClick={() => onUnwatch(item, watchedRepo)} /> : null}
        <RitualAction icon="ph:x" label={`Dismiss ${item.title}`} text="Dismiss" onClick={() => onDismiss(item)} />
      </RitualActions>
    </li>
  );
}

export function RitualAgendaThread({ items, familiarLabel, onSelect }: { items: InboxItem[]; familiarLabel: (familiarId?: string | null) => string | null; onSelect: (item: InboxItem) => void }) {
  const now = Date.now();
  const upcoming = items.filter((item) => (ritualItemDate(item)?.getTime() ?? 0) >= now).slice(0, 8).reverse();
  const past = [...items].reverse().filter((item) => (ritualItemDate(item)?.getTime() ?? 0) < now).slice(0, 8);
  const renderThreadItem = (item: InboxItem) => {
    const date = ritualItemDate(item);
    const label = date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date) : "—";
    return (
      <div className="rituals-overview__thread-group" key={item.id}>
        <span className="rituals-overview__thread-date">{label}</span>
        <div className="rituals-overview__thread-line">
          <RitualItemRow item={item} familiarLabel={familiarLabel} onSelect={onSelect} quiet />
        </div>
      </div>
    );
  };

  return (
    <div className="rituals-overview__thread">
      {upcoming.length > 0 ? upcoming.map(renderThreadItem) : <p className="rituals-overview__empty">Nothing scheduled ahead.</p>}
      <div className="rituals-overview__now"><span>now</span><span className="rituals-overview__now-line"><span /></span></div>
      {past.map(renderThreadItem)}
    </div>
  );
}
