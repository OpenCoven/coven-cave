import type { CardStatus } from "@/lib/cave-board-types";
import { readDateTimePrefs } from "@/lib/datetime-format";

export type ScheduleUrgency = "overdue" | "due-soon" | "none";

/**
 * Compact board date from an ISO date string ("2026-06-19"), ordered by the
 * user's date preference: "06/19" (month-first) or "19/06" (day-first).
 */
export function formatBoardDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return readDateTimePrefs().date === "ddmm" ? `${day}/${month}` : `${month}/${day}`;
}

/** Compact schedule-window label shown on board cards (kanban + mobile rail). */
export function scheduleLabel(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  if (startDate && endDate) {
    if (startDate === endDate) return formatBoardDate(startDate);
    return `${formatBoardDate(startDate)}-${formatBoardDate(endDate)}`;
  }
  if (startDate) return `Starts ${formatBoardDate(startDate)}`;
  if (endDate) return `Ends ${formatBoardDate(endDate)}`;
  return "";
}

/**
 * Whether a card's end date has passed (overdue) or is within two days (due
 * soon) — drives the schedule chip color on both the kanban and the mobile
 * rail. Done cards never flag, and `todayMs` is null until mount so the first
 * client render matches SSR (callers resolve it in an effect).
 */
export function scheduleUrgency(
  endDate: string | null | undefined,
  status: CardStatus,
  todayMs: number | null,
): ScheduleUrgency {
  if (!endDate || status === "done" || todayMs === null) return "none";
  const [y, m, d] = endDate.split("-").map(Number);
  if (!y || !m || !d) return "none";
  const due = new Date(y, m - 1, d).getTime();
  const now = new Date(todayMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((due - today) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 2) return "due-soon";
  return "none";
}
