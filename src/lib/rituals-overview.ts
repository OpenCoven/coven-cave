import type { InboxItem } from "@/lib/cave-inbox";

export type RitualDay = {
  date: Date;
  key: string;
  weekday: string;
  day: number;
  isToday: boolean;
  hasItems: boolean;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function itemTime(item: InboxItem, mode: "agenda" | "log"): number {
  const iso =
    mode === "agenda"
      ? item.fireAt ?? item.firedAt ?? item.updatedAt
      : item.firedAt ?? item.updatedAt ?? item.createdAt;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function visibleItems(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => item.status !== "dismissed");
}

export function buildRitualWeek(items: InboxItem[], now = new Date()): RitualDay[] {
  const today = startOfDay(now);
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  const scheduledDays = new Set(
    visibleItems(items)
      .map((item) => item.fireAt ?? item.firedAt)
      .filter((iso): iso is string => Boolean(iso))
      .map((iso) => {
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? "" : dateKey(date);
      })
      .filter(Boolean),
  );

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    const key = dateKey(date);
    return {
      date,
      key,
      weekday: new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date),
      day: date.getDate(),
      isToday: date.getTime() === today.getTime(),
      hasItems: scheduledDays.has(key),
    };
  });
}

export function ritualAgendaItems(items: InboxItem[]): InboxItem[] {
  return visibleItems(items)
    .filter((item) => Boolean(item.fireAt ?? item.firedAt))
    .sort((a, b) => itemTime(a, "agenda") - itemTime(b, "agenda"));
}

export function ritualLogItems(items: InboxItem[]): InboxItem[] {
  return visibleItems(items).sort((a, b) => itemTime(b, "log") - itemTime(a, "log"));
}
