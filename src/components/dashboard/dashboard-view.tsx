import { dashboardLayout, type DashboardModel } from "@/lib/dashboard-model";
import { DashboardHero } from "./dashboard-hero";
import { ActionInbox } from "./action-inbox";
import { CaughtUpStrip } from "./caught-up-strip";
import { ReportCallout } from "./report-callout";
import { LauncherGrid } from "./launcher-grid";
import { RecentReports } from "./recent-reports";

/** Adaptive shell: renders the hero, then the ordered zones for the state. */
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
          case "reportCallout":
            return (
              <ReportCallout
                key={zone}
                featured={model.featuredReport}
                isToday={Boolean(model.todaysReport)}
                now={model.date}
              />
            );
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
        This dashboard reads your local inbox and session activity. Reminders and replies are live; daily
        reports are point-in-time snapshots generated automatically.
      </footer>
    </div>
  );
}
