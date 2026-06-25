import { FamiliarAnalyticsView } from "@/components/familiar-analytics-view";

export const dynamic = "force-dynamic";

export default async function FamiliarAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FamiliarAnalyticsView familiarId={id} />;
}
