import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings — CovenCave",
};

export default function SettingsPage() {
  return <SettingsShell />;
}

// Client shell lives below — keeps page.tsx a server component for metadata
import { SettingsShell } from "@/components/settings-shell";
