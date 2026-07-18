import { ProfileCardView } from "@/components/profile-card";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";

export const dynamic = "force-dynamic";

export default async function FamiliarProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AnalyticsPageShell>
      <ProfileCardView kind="familiar" familiarId={id} />
    </AnalyticsPageShell>
  );
}
