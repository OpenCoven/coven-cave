import { dashboardLayout, type DashboardModel } from "@/lib/dashboard-model";
import { DashboardHero } from "./dashboard-hero";
import { ActionInbox } from "./action-inbox";
import { CaughtUpStrip } from "./caught-up-strip";
import { MetricsStrip } from "./metrics-strip";
import { TodaySummary } from "./today-summary";
import { FamiliarUpdates } from "./familiar-updates";
import { LauncherGrid } from "./launcher-grid";
import { RecentReports } from "./recent-reports";

/**
 * Adaptive single-page shell: renders the hero, then the ordered zones for the
 * current state. Today's daily summary (metrics, narrative, familiar updates)
 * lives inline here — the dashboard is the day's report plus live triage.
 */
export function DashboardView({ model }: { model: DashboardModel }) {
  const zones = dashboardLayout(model);
  return (
    <div className="dr-shell">
      <DashboardHero now={model.date} needsCount={model.needsAttention.length} />
      {zones.map((zone) => {
        switch (zone) {
          case "caughtUpStrip":
            return <CaughtUpStrip key={zone} />;
          case "actionInbox":
            return <ActionInbox key={zone} initialItems={model.needsAttention} />;
          case "metrics":
            return <MetricsStrip key={zone} metrics={model.metrics} live={model.metricsLive} />;
          case "todaySummary":
            return (
              <TodaySummary
                key={zone}
                summary={model.todaySummary}
                featured={model.featuredReport}
                now={model.date}
              />
            );
          case "familiarUpdates":
            return <FamiliarUpdates key={zone} items={model.familiarUpdates} now={model.date} />;
          case "launcher":
            return <LauncherGrid key={zone} variant={model.caughtUp ? "full" : "compact"} />;
          case "recentReports":
            return (
              <RecentReports
                key={zone}
                reports={model.recentReports}
                now={model.date}
                hasFeatured={Boolean(model.featuredReport)}
              />
            );
          default:
            return null;
        }
      })}
      <footer className="dr-footer">
        This dashboard reads your local inbox and session activity. Reminders and replies are live;
        today&apos;s summary and headline numbers come from the auto-generated daily report.
      </footer>
    </div>
  );
}
