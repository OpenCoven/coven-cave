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
      <div className="dr-cta dash-cta--static">
        <div className="dash-cta__row">
          <span className="dr-cta__icon">
            <Icon name="ph:newspaper" aria-hidden />
          </span>
          <span className="dash-cta__text">
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
      <div className="dash-cta__row">
        <span className="dr-cta__icon">
          <Icon name="ph:newspaper" aria-hidden />
        </span>
        <span className="dash-cta__text">
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
