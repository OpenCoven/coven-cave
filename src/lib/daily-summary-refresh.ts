import type { InboxItem } from "./cave-inbox";
import type { SessionRow } from "./types";
import { dateSlug } from "./daily-summary-notifications.ts";

/** Minimum gap between daily-summary POSTs — the sessions list polls every 4s,
 *  so refresh decisions must throttle well above that cadence. */
export const DAILY_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

/** Fallback poll that forces a refresh attempt even when the client-visible
 *  signature is unchanged (picks up server-only changes, rolls the date). */
export const DAILY_REFRESH_POLL_MS = 15 * 60_000;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function sameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  return value >= start && value.getTime() < start.getTime() + 24 * 60 * 60 * 1000;
}

/** Stable signature over the inputs that feed today's report: the date slug,
 *  the count-input inbox items (id/status/timestamps — never the daily-summary
 *  item itself, so the refresh it triggers can't re-trigger it), and today's
 *  sessions (id + updated_at). Changes exactly when a rebuild would produce
 *  different content. */
export function dailySummarySignature({
  items,
  sessions,
  now = new Date(),
}: {
  items: InboxItem[];
  sessions: SessionRow[];
  now?: Date;
}): string {
  const itemParts = items
    .filter(
      (item) =>
        item.kind === "reminder" || item.kind === "response-needed" || item.kind === "agent",
    )
    .map((item) => `${item.id}:${item.status}:${item.firedAt ?? ""}:${item.updatedAt ?? ""}`)
    .sort();
  const sessionParts = sessions
    .filter((session) => !session.archived_at && sameLocalDay(session.updated_at, now))
    .map((session) => `${session.id}:${session.updated_at}`)
    .sort();
  return `${dateSlug(now)}.${fnv1a(itemParts.join("|"))}.${fnv1a(sessionParts.join("|"))}`;
}

/** Refresh policy: create immediately when today's report is missing, else
 *  refresh only when the signature changed (or a forced poll tick asks) and
 *  the minimum interval since the last attempt has passed. `lastAttemptAt` is
 *  epoch ms of the last POST attempt (0 = never this day). */
export function shouldRefreshDailySummary({
  hasItem,
  signature,
  lastSignature,
  lastAttemptAt,
  now,
  force = false,
}: {
  hasItem: boolean;
  signature: string;
  lastSignature: string | null;
  lastAttemptAt: number;
  now: Date;
  force?: boolean;
}): boolean {
  const elapsed = now.getTime() - lastAttemptAt;
  if (!hasItem) return lastAttemptAt === 0 || elapsed >= DAILY_REFRESH_MIN_INTERVAL_MS;
  if (elapsed < DAILY_REFRESH_MIN_INTERVAL_MS) return false;
  return force || signature !== lastSignature;
}
