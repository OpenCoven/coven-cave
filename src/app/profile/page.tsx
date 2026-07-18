import { ProfileCardView } from "@/components/profile-card";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";

export const dynamic = "force-dynamic";

export default function HumanProfilePage() {
  return (
    <AnalyticsPageShell>
      <ProfileCardView kind="human" />
    </AnalyticsPageShell>
  );
}
