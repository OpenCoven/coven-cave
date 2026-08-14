import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { WeavesView } from "@/components/weaves-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Weaves — CovenCave",
};

/**
 * Each weave is a familiar's enforced pattern of threads over its protected
 * memory; each thread binds one surface to one writer. Status traces to
 * predicate results — anything unverifiable renders blocked, never healthy.
 *
 * The surface owns its own chrome (breadcrumb, the single primary action, and
 * the pending-decision count inside it) because the count is live state; the
 * page is only the shell it fills. See components/threads-chrome.tsx.
 */
export default function WeavesPage() {
  return (
    <AnalyticsPageShell>
      <WeavesView />
    </AnalyticsPageShell>
  );
}
