"use client";

/**
 * HomeNeedsYou — morning triage in one glance (cave-925w). The strip under the
 * composer surfaces the same "needs you" attention tier the Schedules nav
 * badge counts (groupInboxFeed: fired items + response-needed bridges), so the
 * first screen answers "what needs me" without touring bell → Schedules →
 * daily report. Rows open their item's target through the same handler the
 * bell popover uses; the header always links today's /daily-report so the
 * answer stays one click deep even when all is clear.
 */

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import type { InboxItem } from "@/lib/cave-inbox";
import { inboxKindLabel } from "@/lib/inbox-feed";
import { dateSlug } from "@/lib/daily-report";

/** Rows shown inline; the rest collapse into a "+N more" jump to Schedules. */
const MAX_ROWS = 3;

// Same kind → glyph mapping the bell popover uses, so an item reads the same
// wherever it surfaces.
function kindIcon(kind: InboxItem["kind"]): IconName {
  switch (kind) {
    case "response-needed":
      return "ph:chat-circle-dots-fill";
    case "daily-summary":
      return "ph:newspaper";
    case "agent":
      return "ph:magic-wand-fill";
    default:
      return "ph:alarm-fill";
  }
}

type Props = {
  /** The "needs you" tier from groupInboxFeed — most-recent first. */
  items: InboxItem[];
  /** Open one item's target (session/card) — same handler the bell uses. */
  onOpenItem: (item: InboxItem) => void;
  /** See the full feed on the Schedules surface. */
  onOpenSchedules: () => void;
};

export function HomeNeedsYou({ items, onOpenItem, onOpenSchedules }: Props) {
  // The strip is persistently mounted (unlike the bell popover), so tick each
  // minute: row times stay honest and the report link rolls over at midnight.
  useMinuteTick();
  // Sampled after mount so SSR markup stays deterministic — same pattern as
  // the hero greeting; the minute tick above recomputes it on re-render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reportSlug = mounted ? dateSlug(new Date()) : null;

  const shown = items.slice(0, MAX_ROWS);
  const overflow = items.length - shown.length;

  return (
    <section className="home-needs-you" aria-label="Needs you">
      <div className="home-needs-you__header">
        <span className={`home-needs-you__count${items.length > 0 ? " is-live" : ""}`}>
          {items.length > 0 ? `Needs you · ${items.length}` : "All clear"}
        </span>
        {reportSlug ? (
          <a className="home-needs-you__report focus-ring" href={`/daily-report/${reportSlug}`}>
            Today&rsquo;s report →
          </a>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <ul className="home-needs-you__list">
          {shown.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="home-needs-you__item focus-ring"
                onClick={() => onOpenItem(it)}
                title={it.title}
              >
                <Icon name={kindIcon(it.kind)} width={12} aria-hidden />
                <span className="home-needs-you__item-title">{it.title}</span>
                <span className="home-needs-you__item-time">
                  {it.kind === "response-needed" ? (
                    "Waiting on you"
                  ) : (
                    <RelativeTime
                      iso={it.firedAt ?? it.fireAt ?? it.updatedAt ?? it.createdAt}
                      fallback="—"
                    />
                  )}
                </span>
                <span className="sr-only">{inboxKindLabel(it.kind)}</span>
              </button>
            </li>
          ))}
          {overflow > 0 ? (
            <li>
              <button
                type="button"
                className="home-needs-you__more focus-ring"
                onClick={onOpenSchedules}
              >
                +{overflow} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
