"use client";

// The daily report as it appears in the Rituals inbox.
//
// Every other inbox item is a thing to act on — a reminder to complete, a
// response to give. The daily report is the opposite: a thing to read. It was
// rendering through the same generic row as the rest, with a "Summary" text
// badge as its only distinguishing mark, which buried the one item in the
// feed that actually carries the day.
//
// Everything here comes off the item's own frozen facts (`media.stats` and
// `media.report`) — no fetching, no derivation the report page doesn't already
// agree with.

import type { InboxItem } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import "@/styles/inbox-daily-report-row.css";

/** "daily-summary:2026-07-27" → "2026-07-27" */
function slugOf(item: InboxItem): string | null {
  const auto = item.auto ?? "";
  const cut = auto.indexOf(":");
  return cut === -1 ? null : auto.slice(cut + 1) || null;
}

function dayLabel(slug: string | null): { weekday: string; day: string; month: string } | null {
  if (!slug) return null;
  const d = new Date(`${slug}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(),
    day: String(d.getDate()),
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
  };
}

/** 24 bars, each 0–1 against the busiest hour, from the day's merge times. */
function mergeHours(item: InboxItem): number[] | null {
  const prs = item.media?.report?.prsMerged;
  if (!prs?.length) return null;
  const counts = new Array(24).fill(0) as number[];
  let any = false;
  for (const pr of prs) {
    const d = new Date(pr.mergedAt);
    if (Number.isNaN(d.getTime())) continue;
    counts[d.getHours()] += 1;
    any = true;
  }
  if (!any) return null;
  const peak = Math.max(...counts);
  return peak > 0 ? counts.map((c) => c / peak) : null;
}

export function InboxDailyReportRow({ item }: { item: InboxItem }) {
  const slug = slugOf(item);
  const label = dayLabel(slug);
  const stats = item.media?.stats ?? null;
  const report = item.media?.report ?? null;
  const hours = mergeHours(item);

  let additions = 0;
  let deletions = 0;
  for (const group of report?.sessionGroups ?? []) {
    additions += group.additions;
    deletions += group.deletions;
  }

  const merged = stats?.prsMerged ?? report?.prsMerged?.length ?? 0;
  const sessions = stats?.sessions ?? 0;
  const projects = report?.sessionGroups?.length ?? 0;

  return (
    <span className="dri">
      {label && (
        <span className="dri__date" aria-hidden>
          <span className="dri__date-weekday">{label.weekday}</span>
          <span className="dri__date-day">{label.day}</span>
          <span className="dri__date-month">{label.month}</span>
        </span>
      )}

      <span className="dri__body">
        <span className="dri__head">
          <span className="dri__title">{item.title}</span>
          <span className="dri__badge">Report</span>
        </span>

        <span className="dri__stats">
          {merged > 0 && (
            <span className="dri__stat">
              <Icon name="ph:git-merge" aria-hidden />
              <b>{merged}</b> merged
            </span>
          )}
          {sessions > 0 && (
            <span className="dri__stat">
              <Icon name="ph:code" aria-hidden />
              <b>{sessions}</b> {sessions === 1 ? "session" : "sessions"}
            </span>
          )}
          {projects > 0 && (
            <span className="dri__stat">
              <b>{projects}</b> {projects === 1 ? "project" : "projects"}
            </span>
          )}
          {(additions > 0 || deletions > 0) && (
            <span className="dri__stat dri__diff">
              <span className="dri__add">+{additions.toLocaleString()}</span>
              <span className="dri__del">−{deletions.toLocaleString()}</span>
            </span>
          )}
          {/* A day with none of the above is quiet — say it rather than
              rendering an empty strip. */}
          {merged === 0 && sessions === 0 && <span className="dri__stat dri__quiet">a quiet day</span>}
        </span>
      </span>

      {hours && (
        <span className="dri__spark" aria-hidden>
          {hours.map((level, i) => (
            <span key={i} className="dri__bar" data-level={level > 0 ? Math.ceil(level * 4) : 0} />
          ))}
        </span>
      )}

      <span className="dri__read">
        Read
        <Icon name="ph:caret-right" aria-hidden />
      </span>
    </span>
  );
}
