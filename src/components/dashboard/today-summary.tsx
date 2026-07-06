import { Icon } from "@/lib/icon";
import { SectionHead } from "@/components/daily-report-ui";
import { relativeTime, type RecentReport } from "@/lib/daily-report";
import type { TodaySummary } from "@/lib/dashboard-model";
import { ReportCallout } from "./report-callout";

/**
 * Today's daily summary, folded inline so the dashboard *is* the day's report:
 * the auto-generated narrative, its illustration, and the recovered session
 * names. Before today's report exists it degrades to the callout that links
 * the latest available report (or a calm "nothing yet" note).
 */
export function TodaySummary({
  summary,
  featured,
  now,
}: {
  summary: TodaySummary | null;
  featured: RecentReport | null;
  now: Date;
}) {
  if (!summary) {
    return <ReportCallout featured={featured} isToday={false} now={now} />;
  }

  const hasBody = summary.body.trim().length > 0;
  return (
    <section className="dr-section dash-today" aria-label="Today's report">
      <SectionHead
        icon="ph:newspaper"
        title="Today's report"
        hint={
          summary.generatedAt
            ? `Updated ${relativeTime(summary.generatedAt, now)} · live`
            : "Live — refreshes today"
        }
      />
      <div className="dash-today__grid">
        <div className="dr-panel dash-today__panel">
          {summary.narrative?.text ? (
            <>
              <p className="dr-summary-body" style={{ whiteSpace: "pre-line" }}>
                {summary.narrative.text}
              </p>
              <p className="dr-narrative-byline">
                <Icon name="ph:sparkle" aria-hidden />
                Written by {summary.narrative.familiarName || "a familiar"}
                {" · "}
                {relativeTime(summary.narrative.generatedAt, now)}
              </p>
            </>
          ) : hasBody ? (
            <p className="dr-summary-body" style={{ whiteSpace: "pre-line" }}>
              {summary.body}
            </p>
          ) : (
            <p className="dr-summary-body dash-today__placeholder">
              Today&apos;s summary is still taking shape — it fills in as activity lands.
            </p>
          )}
          {summary.report?.prsMerged && summary.report.prsMerged.length > 0 ? (
            <div className="dash-today__sessions" aria-label="Merged pull requests">
              <span className="dash-today__sessions-label">
                <Icon name="ph:git-pull-request" aria-hidden />
                Shipped
              </span>
              <div className="dash-today__chips">
                {summary.report.prsMerged.map((pr) => (
                  <a
                    key={`${pr.repo}#${pr.number}`}
                    className="dash-today__chip dash-today__chip--link"
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    title={pr.title}
                  >
                    {pr.repo.split("/").pop()}#{pr.number}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {summary.recentSessions.length > 0 ? (
            <div className="dash-today__sessions" aria-label="Recent sessions">
              <span className="dash-today__sessions-label">
                <Icon name="ph:code-bold" aria-hidden />
                Recent sessions
              </span>
              <div className="dash-today__chips">
                {summary.recentSessions.map((name, i) => (
                  <span key={i} className="dash-today__chip">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
