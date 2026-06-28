/**
 * Pure builder for the home-page "Daily summary" carousel.
 *
 * Combines three signals into one ordered card list:
 *   1. a single summary card — today's at-a-glance counts (sessions, reminders,
 *      responses waiting, familiar updates), mirroring the daily-summary digest;
 *   2. session cards — the chats touched today, newest first (click to resume);
 *   3. RSS cards — the freshest merged headlines (click opens externally).
 *
 * Everything here is pure and clock-injected (`nowMs`) so it unit-tests without
 * a network, DOM, or wall clock (see home-digest.test.ts).
 */

import type { InboxItem } from "@/lib/cave-inbox";
import type { SessionRow } from "@/lib/types";
import { hostFromUrl, relativeAge, type FeedItem } from "@/lib/rss";

export type DigestSummaryCard = {
  kind: "summary";
  id: string;
  /** Always "Daily summary". */
  title: string;
  /** Short month/day label, e.g. "Jun 28". */
  dayLabel: string;
  /** Pre-formatted count chips, e.g. ["3 sessions", "1 reminder"]. */
  lines: string[];
};

export type DigestSessionCard = {
  kind: "session";
  id: string;
  sessionId: string;
  familiarId: string | null;
  title: string;
  /** "familiar · 3h · +12 -4" (only the present parts). */
  subtitle: string;
};

export type DigestRssCard = {
  kind: "rss";
  id: string;
  title: string;
  source: string;
  host: string | null;
  url: string;
  /** Compact relative age, e.g. "2h". */
  age: string;
  /** First http(s) image pulled from the item body — the media row's thumbnail. */
  image?: string;
};

export type DigestCard = DigestSummaryCard | DigestSessionCard | DigestRssCard;

export type BuildDigestInput = {
  items: InboxItem[];
  sessions: SessionRow[];
  rssItems: FeedItem[];
  /** Maps a familiar id to its display name (for session subtitles). */
  familiarNameById?: Map<string, string>;
  nowMs: number;
  /** Max session cards (default 6) and RSS cards (default 14). */
  maxSessions?: number;
  maxRss?: number;
};

function sameLocalDay(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Pull the first http(s) image out of a feed item's body HTML for the media-row
 * thumbnail. Returns undefined for protocol-relative/inline/data URIs or no img,
 * so the card cleanly falls back to its icon. Pure — unit-tested.
 */
export function firstImageUrl(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const src = html.match(/<img[^>]+\bsrc=["']([^"']+)["']/i)?.[1];
  return src && /^https?:\/\//i.test(src) ? src : undefined;
}

function dayLabel(now: Date): string {
  return now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Build the ordered carousel cards. Returns [] when there's nothing to show
 *  (no activity today and no headlines), so the home strip stays hidden. */
export function buildDigestCards(input: BuildDigestInput): DigestCard[] {
  const { items, sessions, rssItems, familiarNameById, nowMs } = input;
  const maxSessions = input.maxSessions ?? 6;
  const maxRss = input.maxRss ?? 14;
  const now = new Date(nowMs);

  const todaySessions = sessions
    .filter((s) => !s.archived_at && sameLocalDay(s.updated_at ?? s.created_at, now))
    .sort((a, b) =>
      (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
    );

  const remindersFired = items.filter(
    (i) => i.kind === "reminder" && i.status === "fired" && sameLocalDay(i.firedAt ?? i.updatedAt, now),
  ).length;
  const responsesWaiting = items.filter(
    (i) =>
      i.kind === "response-needed" &&
      (i.status === "pending" || i.status === "fired") &&
      sameLocalDay(i.updatedAt, now),
  ).length;
  const familiarUpdates = items.filter(
    (i) => i.kind === "agent" && i.status === "fired" && sameLocalDay(i.firedAt ?? i.updatedAt, now),
  ).length;

  const cards: DigestCard[] = [];

  const summaryLines: string[] = [];
  if (todaySessions.length) summaryLines.push(plural(todaySessions.length, "session"));
  if (remindersFired) summaryLines.push(plural(remindersFired, "reminder"));
  if (responsesWaiting) summaryLines.push(`${responsesWaiting} waiting`);
  if (familiarUpdates) summaryLines.push(plural(familiarUpdates, "familiar update"));

  if (summaryLines.length) {
    cards.push({
      kind: "summary",
      id: "summary",
      title: "Daily summary",
      dayLabel: dayLabel(now),
      lines: summaryLines,
    });
  }

  for (const s of todaySessions.slice(0, maxSessions)) {
    const fam = s.familiarId ? familiarNameById?.get(s.familiarId) ?? null : null;
    const age = relativeAge(s.updated_at ?? s.created_at ?? null, nowMs);
    const diff = s.diff ? `+${s.diff.additions} -${s.diff.deletions}` : "";
    const subtitle = [fam, age, diff].filter(Boolean).join(" · ");
    cards.push({
      kind: "session",
      id: `session:${s.id}`,
      sessionId: s.id,
      familiarId: s.familiarId ?? null,
      title: s.title?.trim() || "Untitled session",
      subtitle,
    });
  }

  for (const r of rssItems.filter((it) => it.link).slice(0, maxRss)) {
    cards.push({
      kind: "rss",
      id: `rss:${r.id}`,
      title: r.title,
      source: r.source,
      host: hostFromUrl(r.link),
      url: r.link,
      age: relativeAge(r.isoDate, nowMs),
      image: firstImageUrl(r.descriptionHtml),
    });
  }

  return cards;
}
