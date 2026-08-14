"use client";

import { useEffect, useState } from "react";
import { BentoDashboard } from "@/components/dashboard/bento-dashboard";
import { buildDashboardModel, type DashboardModel } from "@/lib/dashboard-model";
import type { InboxItem } from "@/lib/cave-inbox";

export function DashboardSurface() {
  const [model, setModel] = useState<DashboardModel>(() => buildDashboardModel([], new Date()));

  useEffect(() => {
    let active = true;
    void fetch("/api/inbox", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { items?: InboxItem[] } : null)
      .then((payload) => {
        if (active && Array.isArray(payload?.items)) {
          setModel(buildDashboardModel(payload.items, new Date()));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="workspace-dashboard-surface h-full min-h-0 min-w-0 overflow-y-auto">
      <BentoDashboard model={model} />
    </div>
  );
}
