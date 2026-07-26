import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { BentoDashboard } from "@/components/dashboard/bento-dashboard";
import { buildDashboardModel } from "@/lib/dashboard-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const inbox = await loadInbox();
  const model = buildDashboardModel(inbox.items, new Date());

  return (
    <AnalyticsPageShell>
      {/* div, not main: the shell's aps-main is the page's main landmark. */}
      <div className="dr-page dr-page--bento">
        <div className="dr-topbar" data-tauri-drag-region="deep">
          <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
            <a className="dr-back" href="/">
              <Icon name="ph:arrow-left" aria-hidden />
              CovenCave
            </a>
            <span className="dr-crumb-sep" aria-hidden>/</span>
            <span className="dr-crumb-current">Dashboard</span>
          </nav>
        </div>

        <BentoDashboard model={model} />
      </div>
    </AnalyticsPageShell>
  );
}
