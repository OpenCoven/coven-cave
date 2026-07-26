import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings — CovenCave",
};

export default function SettingsPage() {
  return (
    <AnalyticsPageShell>
      <SettingsShell />
    </AnalyticsPageShell>
  );
}

// Client shells live below — keeps page.tsx a server component for metadata
import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { SettingsShell } from "@/components/settings-shell";
