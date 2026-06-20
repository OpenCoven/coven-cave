import { CopyLinkButton } from "@/components/copy-link-button";
import { RetroRunsView } from "@/components/retro-runs-view";
import { Icon } from "@/lib/icon";

export const dynamic = "force-dynamic";

export default function RetroDashboardPage() {
  return (
    <main className="dr-page">
      <div className="dr-topbar">
        <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
          <a className="dr-back" href="/dashboard">
            <Icon name="ph:arrow-left" aria-hidden />
            Dashboard
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <span className="dr-crumb-current">Retro Runs</span>
        </nav>
        <div className="dr-topbar__actions">
          <CopyLinkButton />
        </div>
      </div>
      <RetroRunsView standalone />
    </main>
  );
}
