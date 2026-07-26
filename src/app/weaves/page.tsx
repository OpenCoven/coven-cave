import { Icon } from "@/lib/icon";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { WeavesView } from "@/components/weaves-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Weaves — CovenCave",
};

export default function WeavesPage() {
  return (
    <AnalyticsPageShell>
      {/* div, not main: the shell's aps-main is the page's main landmark. */}
      <div className="dr-page">
        <div className="dr-topbar" data-tauri-drag-region="deep">
          <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
            <a className="dr-back" href="/">
              <Icon name="ph:arrow-left" aria-hidden />
              CovenCave
            </a>
            <span className="dr-crumb-sep" aria-hidden>/</span>
            <span className="dr-crumb-current">Weaves</span>
          </nav>
        </div>
        <div className="px-4 pb-6">
          <p className="mb-3 max-w-2xl text-xs text-[var(--text-muted)]">
            Each weave is a familiar&apos;s enforced pattern of threads over its protected memory; each
            thread binds one surface to one writer. Status here traces to predicate results — anything
            unverifiable renders blocked, never healthy.
          </p>
          <WeavesView />
        </div>
      </div>
    </AnalyticsPageShell>
  );
}
