// Presentational building blocks shared by the standalone `/daily-report/[date]`
// and `/dashboard` routes. These are server components — they render the
// client-only <Icon> as a leaf island, which Next.js allows. Keeping them here
// means both pages speak the same visual grammar (metric cards, item rows,
// section headers) without copy-paste drift.

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import {
  KIND_ICON,
  KIND_LABEL,
  itemHasTarget,
  itemHref,
  relativeTime,
} from "@/lib/daily-report";

export type Accent = "lavender" | "amber" | "rose" | "green" | "blue";

const ACCENT_VAR: Record<Accent, string> = {
  lavender: "var(--accent-presence)",
  amber: "var(--color-warning)",
  rose: "var(--color-danger)",
  green: "var(--color-success)",
  blue: "var(--color-info)",
};

export function MetricCard({
  icon,
  value,
  label,
  caption,
  accent = "lavender",
  href,
}: {
  icon: IconName;
  value: number | string;
  label: string;
  caption?: string;
  accent?: Accent;
  href?: string;
}) {
  const muted = value === 0 || value === "0";
  const className = `dr-metric${muted ? " dr-metric--muted" : ""}${href ? " dr-metric--link" : ""}`;
  const style = { ["--metric-accent" as string]: ACCENT_VAR[accent] };
  const inner = (
    <>
      <div className="dr-metric__top">
        <span className="dr-metric__icon">
          <Icon name={icon} aria-hidden />
        </span>
        {href ? (
          <span className="dr-metric__go" aria-hidden>
            <Icon name="ph:arrow-right-bold" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="dr-metric__value">{value}</div>
      <div className="dr-metric__label">{label}</div>
      {caption ? <div className="dr-metric__caption">{caption}</div> : null}
    </>
  );
  if (href) {
    return (
      <a className={className} style={style} href={href}>
        {inner}
      </a>
    );
  }
  return (
    <div className={className} style={style}>
      {inner}
    </div>
  );
}

export function SectionHead({
  icon,
  title,
  count,
  hint,
}: {
  icon: IconName;
  title: string;
  count?: number;
  hint?: string;
}) {
  return (
    <div className="dr-section__head">
      <h2 className="dr-section__title">
        <Icon name={icon} aria-hidden />
        {title}
      </h2>
      {typeof count === "number" ? <span className="dr-count">{count}</span> : null}
      {hint ? <span className="dr-section__hint">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="dr-empty">
      <Icon name={icon} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

const ROW_ACCENT: Record<InboxItem["kind"], string> = {
  reminder: ACCENT_VAR.amber,
  agent: ACCENT_VAR.lavender,
  "response-needed": ACCENT_VAR.rose,
  "daily-summary": ACCENT_VAR.blue,
};

/** A single actionable inbox item. Renders as a deep link when it has a target. */
export function ItemRow({ item, now }: { item: InboxItem; now?: Date }) {
  const hasTarget = itemHasTarget(item);
  const accent = ROW_ACCENT[item.kind];
  const when = relativeTime(item.firedAt ?? item.updatedAt, now);
  const inner = (
    <>
      <span className="dr-row__icon">
        <Icon name={KIND_ICON[item.kind] as IconName} aria-hidden />
      </span>
      <span className="dr-row__body">
        <span className="dr-row__title">{item.title}</span>
        {item.body ? <span className="dr-row__sub">{item.body}</span> : null}
        <span className="dr-row__metaline">
          <span className="dr-tag">{KIND_LABEL[item.kind]}</span>
          {when ? <span className="dr-row__time">{when}</span> : null}
        </span>
      </span>
      {hasTarget ? (
        <span className="dr-row__open">
          <span>Open</span>
          <Icon name="ph:arrow-right-bold" aria-hidden />
        </span>
      ) : null}
    </>
  );

  if (hasTarget) {
    return (
      <a
        className="dr-row"
        href={itemHref(item)}
        style={{ ["--row-accent" as string]: accent }}
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="dr-row" style={{ ["--row-accent" as string]: accent }}>
      {inner}
    </div>
  );
}

export function QuickLink({
  href,
  icon,
  label,
  sub,
}: {
  href: string;
  icon: IconName;
  label: string;
  sub?: string;
}) {
  return (
    <a className="dr-quicklink" href={href}>
      <span className="dr-quicklink__icon">
        <Icon name={icon} aria-hidden />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="dr-quicklink__label" style={{ display: "block" }}>
          {label}
        </span>
        {sub ? <span className="dr-quicklink__sub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
    </a>
  );
}
