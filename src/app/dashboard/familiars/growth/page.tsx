import { FamiliarGrowthView } from "@/components/familiar-growth-view";
import { Icon } from "@/lib/icon";

export const dynamic = "force-dynamic";

export default function FamiliarGrowthDashboardPage() {
  return (
    <main className="dr-page">
      <div className="dr-topbar">
        <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
          <a className="dr-back" href="/dashboard">
            <Icon name="ph:arrow-left" aria-hidden />
            Dashboard
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <a className="dr-back" href="/#familiars">
            Familiars
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <span className="dr-crumb-current">Growth</span>
        </nav>
      </div>
      <FamiliarGrowthView standalone />
    </main>
  );
}
