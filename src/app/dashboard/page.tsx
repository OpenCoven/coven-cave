import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { DashboardCockpit } from "@/components/dashboard/dashboard-cockpit";
import { buildDashboardModel } from "@/lib/dashboard-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const inbox = await loadInbox();
  const model = buildDashboardModel(inbox.items, new Date());

  return (
    <main className="dr-page">
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

      <DashboardCockpit model={model} />
    </main>
  );
}
