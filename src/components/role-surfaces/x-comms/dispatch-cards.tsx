"use client";

/**
 * The three cards that are not the Approval card.
 *
 *  - **Human in control** states the room's one promise — nothing posts itself
 *    — and then backs it with counts rather than leaving it as a slogan.
 *  - **Trends & timing** is reference only. Its one write is "insert as
 *    reference → notes", which appends a line to the draft's local notes field
 *    and never touches the body. That boundary is the whole reason the card is
 *    allowed to exist beside a composer.
 *  - **Analytics** has one canonical layout — sparkline, 7-day row, 8 metrics.
 *    The predecessor had two variants that disagreed about the same numbers.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";
import {
  formatCount,
  isInPeakBand,
  relativeLabel,
  slotLabel,
  weekdayLabelsEndingToday,
  X_FOLLOWER_ACTIVITY,
  X_IMPRESSIONS_7D,
  type XDraft,
} from "@/lib/x-comms-model";
import { X_TRENDS } from "./fixtures";

export function CardShell({
  id,
  title,
  subtitle,
  iconName,
  open,
  onToggle,
  headAction,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  iconName: IconName;
  open: boolean;
  onToggle: () => void;
  headAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="x-comms-card" id={`x-comms-card-${id}`} aria-label={title}>
      <header className="x-comms-card-head">
        <button
          type="button"
          className="x-comms-card-toggle focus-ring"
          aria-expanded={open}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          title={open ? "Collapse" : "Expand"}
          onClick={onToggle}
        >
          <Icon
            name={open ? "ph:caret-down" : "ph:caret-right"}
            width={12}
            height={12}
            aria-hidden
          />
        </button>
        <span className="x-comms-card-icon">
          <Icon name={iconName} width={13} height={13} aria-hidden />
        </span>
        <span className="x-comms-card-heading">
          <h3>{title}</h3>
          <span className="x-comms-card-sub">{subtitle}</span>
        </span>
        {headAction && <span className="x-comms-card-head-action">{headAction}</span>}
      </header>
      {open && children}
    </section>
  );
}

export function ControlCard({
  open,
  whyOpen,
  draftCount,
  pendingCount,
  scheduledCount,
  onToggle,
  onToggleWhy,
}: {
  open: boolean;
  whyOpen: boolean;
  draftCount: number;
  pendingCount: number;
  scheduledCount: number;
  onToggle: () => void;
  onToggleWhy: () => void;
}) {
  const stages = [
    { label: "drafting", who: "Echo writes", count: draftCount, hot: false, filled: true },
    { label: "needs you", who: "you approve", count: pendingCount, hot: pendingCount > 0, filled: true },
    { label: "scheduled", who: "you set the slot", count: scheduledCount, hot: false, filled: false },
  ];

  return (
    <CardShell
      id="control"
      title="Human in control"
      subtitle="Echo writes. You approve. Every post waits for a slot you set."
      iconName="ph:lock-simple"
      open={open}
      onToggle={onToggle}
      headAction={
        <Button
          variant="ghost"
          size="xs"
          trailingIcon={whyOpen ? "ph:caret-up" : "ph:caret-down"}
          aria-expanded={whyOpen}
          onClick={onToggleWhy}
        >
          why
        </Button>
      }
    >
      <div className="x-comms-card-body">
        <strong className="x-comms-claim">Nothing posts itself.</strong>
        <ol className="x-comms-gate">
          {stages.map((stage) => (
            <li key={stage.label}>
              <span className="x-comms-gate-stage" data-hot={stage.hot ? "true" : undefined}>
                <span
                  className="x-comms-dot"
                  data-filled={stage.filled ? "true" : "false"}
                  style={
                    {
                      "--x-dot-tone": stage.hot
                        ? "var(--x-accent)"
                        : stage.filled
                          ? "var(--x-state-draft)"
                          : "var(--x-state-scheduled)",
                    } as React.CSSProperties
                  }
                  aria-hidden
                />
                {stage.label}
              </span>
              <span className="x-comms-gate-who">{stage.who}</span>
              <span className="x-comms-gate-count" data-hot={stage.hot ? "true" : undefined}>
                {stage.count}
              </span>
            </li>
          ))}
        </ol>
        {/* Stated as a fact rather than hidden behind a disabled button: there
            is no approve-all, and a greyed-out one would imply there could be. */}
        <p className="x-comms-facts">
          auto-posts <strong>0</strong> · bulk approve <strong>off</strong> · write scope{" "}
          <strong>per-post</strong>
        </p>
        {whyOpen && (
          <p className="x-comms-why">
            The connected X account is read-only until you approve a post. Approval unlocks a
            single write for that post at its slot; nothing else can use it. There is no
            approve-all — each release is a separate, typed decision.
          </p>
        )}
      </div>
    </CardShell>
  );
}

export function TrendsCard({
  open,
  openTrend,
  timingOpen,
  hasSelection,
  now,
  nextSlotAt,
  onToggle,
  onToggleTrend,
  onToggleTiming,
  onInsertReference,
}: {
  open: boolean;
  openTrend: number | null;
  timingOpen: boolean;
  hasSelection: boolean;
  now: number;
  nextSlotAt: number;
  onToggle: () => void;
  onToggleTrend: (index: number) => void;
  onToggleTiming: () => void;
  onInsertReference: (line: string) => void;
}) {
  const peak = Math.max(...X_FOLLOWER_ACTIVITY);

  return (
    <CardShell
      id="trends"
      title="Trends &amp; timing"
      subtitle="Reference only. Never inserted into a draft."
      iconName="ph:trend-up"
      open={open}
      onToggle={onToggle}
    >
      <ul className="x-comms-trends">
        {X_TRENDS.map((trend, index) => {
          const expanded = openTrend === index;
          return (
            <li key={trend.topic}>
              <button
                type="button"
                className="x-comms-trend-toggle focus-ring"
                aria-expanded={expanded}
                onClick={() => onToggleTrend(index)}
              >
                <span className="x-comms-trend-topic" title={trend.topic}>
                  {trend.topic}
                </span>
                <span className="x-comms-trend-vol">{trend.volume} posts</span>
                <span
                  className="x-comms-trend-delta"
                  data-up={trend.rising ? "true" : "false"}
                >
                  <Icon
                    name={trend.rising ? "ph:trend-up" : "ph:trend-down"}
                    width={11}
                    height={11}
                    aria-hidden
                  />
                  {trend.delta}
                </span>
              </button>
              {expanded && (
                <div className="x-comms-trend-detail">
                  <p>{trend.summary}</p>
                  <dl className="x-comms-defs">
                    <dt>peak</dt>
                    <dd>{trend.peak}</dd>
                    <dt>leading</dt>
                    <dd>{trend.leading}</dd>
                    <dt>overlap</dt>
                    <dd>{trend.overlap}</dd>
                  </dl>
                  {hasSelection && (
                    <button
                      type="button"
                      className="x-comms-insert-ref focus-ring"
                      title="Appends a one-line reference to this draft's notes field. Never touches the post body."
                      onClick={() =>
                        onInsertReference(
                          `ref: ${trend.topic} · ${trend.volume} posts · peak ${trend.peak}`,
                        )
                      }
                    >
                      insert as reference → notes
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="x-comms-timing focus-ring"
        aria-expanded={timingOpen}
        onClick={onToggleTiming}
      >
        <span className="x-comms-timing-head">
          <span>best time to post</span>
          <span>
            <Icon
              name={timingOpen ? "ph:caret-up" : "ph:caret-down"}
              width={11}
              height={11}
              aria-hidden
            />
          </span>
        </span>
        <span className="x-comms-timing-value">
          <strong>6:10 PM PT</strong>
          <span className="x-comms-trend-vol">followers most active 5–7 PM</span>
        </span>
        {timingOpen && (
          <span className="x-comms-timing-detail">
            <span
              className="x-comms-activity"
              role="img"
              aria-label="Follower activity by hour, peaking 5 to 7 PM PT"
            >
              {X_FOLLOWER_ACTIVITY.map((value, hour) => (
                <span
                  key={hour}
                  data-peak={isInPeakBand(hour) ? "true" : undefined}
                  title={`${((hour + 11) % 12) + 1} ${hour < 12 ? "AM" : "PM"} · ${value}% of daily activity`}
                  style={
                    { "--x-bar-h": `${Math.max(2, Math.round((value / peak) * 36))}px` } as React.CSSProperties
                  }
                />
              ))}
            </span>
            <span className="x-comms-axis">
              <span>12 AM</span>
              <span>6</span>
              <span>12 PM</span>
              <span>6</span>
              <span>11 PM</span>
            </span>
            <dl className="x-comms-defs">
              <dt>window</dt>
              <dd>5:00–7:00 PM PT · weekdays</dd>
              <dt>next slot</dt>
              <dd>{slotLabel(now, nextSlotAt)} · used by Approve</dd>
              <dt>basis</dt>
              <dd>28-day follower activity · PT</dd>
            </dl>
          </span>
        )}
      </button>
    </CardShell>
  );
}

export function AnalyticsCard({
  open,
  lastPosted,
  now,
  onToggle,
}: {
  open: boolean;
  lastPosted: XDraft | null;
  now: number;
  onToggle: () => void;
}) {
  const metrics = lastPosted?.metrics ?? null;
  const rows: Array<[string, string]> = [
    ["impressions", metrics ? formatCount(metrics.impressions) : "—"],
    ["eng rate", metrics ? `${metrics.engagementRate}%` : "—"],
    ["likes", metrics ? String(metrics.likes) : "—"],
    ["reposts", metrics ? String(metrics.reposts) : "—"],
    ["replies", metrics ? String(metrics.replies) : "—"],
    ["bookmarks", metrics ? String(metrics.bookmarks) : "—"],
    ["profile visits", metrics ? String(metrics.profileVisits) : "—"],
    ["link clicks", metrics ? String(metrics.linkClicks) : "—"],
  ];

  const max = Math.max(...X_IMPRESSIONS_7D);
  const points = X_IMPRESSIONS_7D.map((value, index) => [
    4 + (index * 252) / (X_IMPRESSIONS_7D.length - 1),
    52 - (value / max) * 46,
  ]);
  const days = weekdayLabelsEndingToday(now, X_IMPRESSIONS_7D.length);
  const total = X_IMPRESSIONS_7D.reduce((sum, value) => sum + value, 0).toFixed(1);

  return (
    <CardShell
      id="analytics"
      title="Analytics"
      subtitle={`Last post · ${lastPosted?.postedAt ? relativeLabel(now, lastPosted.postedAt) : "none yet"}`}
      iconName="ph:chats-circle"
      open={open}
      onToggle={onToggle}
    >
      <div className="x-comms-spark">
        <span className="x-comms-spark-head">
          <span>impressions · 7 days</span>
          <span>{total}K total</span>
        </span>
        <svg
          viewBox="0 0 260 56"
          preserveAspectRatio="none"
          role="img"
          aria-label={`7-day impressions: ${X_IMPRESSIONS_7D.map((value) => `${value}K`).join(", ")}`}
        >
          <polyline
            points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="var(--x-accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={points[points.length - 1][0].toFixed(1)}
            cy={points[points.length - 1][1].toFixed(1)}
            r="2.5"
            fill="var(--x-accent)"
          />
        </svg>
        <div className="x-comms-spark-days">
          {X_IMPRESSIONS_7D.map((value, index) => (
            <span
              key={index}
              className="x-comms-spark-day"
              data-latest={index === X_IMPRESSIONS_7D.length - 1 ? "true" : undefined}
            >
              <span>{value}K</span>
              <span>{days[index]}</span>
            </span>
          ))}
        </div>
      </div>

      <dl className="x-comms-metrics">
        {rows.map(([key, value]) => (
          <div key={key} className="x-comms-metric">
            <dt title={key}>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </CardShell>
  );
}
