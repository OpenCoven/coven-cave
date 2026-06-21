import { Icon } from "@/lib/icon";
import { EmptyState, SectionHead } from "@/components/daily-report-ui";
import { relativeDayLabel, type RecentReport } from "@/lib/daily-report";

export function RecentReports({
  reports,
  now,
  hasFeatured,
}: {
  reports: RecentReport[];
  now: Date;
  hasFeatured: boolean;
}) {
  const VISIBLE = 7;
  const hiddenCount = Math.max(0, reports.length - VISIBLE);
  return (
    <section className="dr-section" id="recent-reports" aria-label="Recent daily reports">
      <SectionHead icon="ph:newspaper" title="Recent daily reports" count={reports.length} />
      {reports.length > 0 ? (
        <div className="dr-list">
          {reports.slice(0, VISIBLE).map((report) => {
            const reportDate = new Date(`${report.slug}T00:00:00`);
            return (
              <a key={report.slug} className="dr-row" href={report.href}>
                <span className="dr-row__icon dash-row--info">
                  <Icon name="ph:newspaper" aria-hidden />
                </span>
                <span className="dr-row__body dr-report-row">
                  <span className="dash-report-row__main">
                    <span className="dr-row__title">{relativeDayLabel(reportDate, now)}</span>
                    <span className="dr-row__sub">{report.title}</span>
                  </span>
                  {report.stats ? (
                    <span className="dr-report-row__stats">
                      <span className="dr-mini-stat" title="Reminders fired"><b>{report.stats.reminders}</b> rem</span>
                      <span className="dr-mini-stat" title="Responses waiting"><b>{report.stats.responses}</b> resp</span>
                      <span className="dr-mini-stat" title="Sessions updated"><b>{report.stats.sessions}</b> sess</span>
                    </span>
                  ) : null}
                </span>
                <span className="dr-row__open">
                  <span>Open</span>
                  <Icon name="ph:arrow-right-bold" aria-hidden />
                </span>
              </a>
            );
          })}
          {hiddenCount > 0 ? (
            <p className="dr-row__sub" style={{ padding: "8px 4px 0", textAlign: "center" }}>
              +{hiddenCount} older {hiddenCount === 1 ? "report" : "reports"} not shown
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyState icon="ph:newspaper">
          {hasFeatured
            ? "Older reports will appear here as new daily summaries are generated."
            : "No daily reports yet. They're generated automatically as you use the cave."}
        </EmptyState>
      )}
    </section>
  );
}
