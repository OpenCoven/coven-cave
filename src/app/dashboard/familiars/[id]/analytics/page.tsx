import { FamiliarAnalyticsView } from "@/components/familiar-analytics-view";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";

export const dynamic = "force-dynamic";

export default async function FamiliarAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AnalyticsPageShell>
      <FamiliarAnalyticsView familiarId={id} />
    </AnalyticsPageShell>
  );
}
