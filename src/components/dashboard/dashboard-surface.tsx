"use client";

import { BentoDashboard } from "@/components/dashboard/bento-dashboard";

export function DashboardSurface() {
  return (
    <div className="workspace-dashboard-surface h-full min-h-0 min-w-0 overflow-y-auto">
      <BentoDashboard />
    </div>
  );
}
