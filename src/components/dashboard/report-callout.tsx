import { Icon } from "@/lib/icon";
import { relativeTime, type RecentReport } from "@/lib/daily-report";

export function ReportCallout({
  featured,
  isToday,
  now,
}: {
  featured: RecentReport | null;
  isToday: boolean;
  now: Date;
}) {
  if (!featured) {
    return (
      <div className="dr-cta" style={{ cursor: "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span className="dr-cta__icon">
            <Icon name="ph:newspaper" aria-hidden />
          </span>
          <span style={{ minWidth: 0 }}>
            <div className="dr-cta__title">No daily report yet</div>
            <div className="dr-cta__sub">
              A daily report is generated automatically once there&apos;s activity to summarize — it&apos;ll appear here.
            </div>
          </span>
        </div>
      </div>
    );
  }
  return (
    <a className="dr-cta" href={featured.href}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
        <span className="dr-cta__icon">
          <Icon name="ph:newspaper" aria-hidden />
        </span>
        <span style={{ minWidth: 0 }}>
          <div className="dr-cta__title">{isToday ? "Today's daily report is ready" : "Latest daily report"}</div>
          <div className="dr-cta__sub">
            {featured.title}
            {featured.generatedAt ? ` · generated ${relativeTime(featured.generatedAt, now)}` : ""}
          </div>
        </span>
      </div>
      <span className="dr-btn dr-btn--primary" aria-hidden>
        Read report
        <Icon name="ph:arrow-right-bold" aria-hidden />
      </span>
    </a>
  );
}
