"use client";

import { useEffect, useState } from "react";
import { DashboardCockpit } from "@/components/dashboard/dashboard-cockpit";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { DashboardModel } from "@/lib/dashboard-model";

type DashboardModelWire = Omit<DashboardModel, "date"> & { date: string };

type DashboardResponse =
  | { ok: true; model: DashboardModelWire }
  | { ok: false; error: string };

type DashboardSurfaceState =
  | { status: "loading" }
  | { status: "ready"; model: DashboardModel }
  | { status: "unavailable" };

function hydrateDashboardModel(model: DashboardModelWire): DashboardModel {
  return { ...model, date: new Date(model.date) };
}

export function DashboardSurface({ initialModel }: { initialModel?: DashboardModel }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DashboardSurfaceState>(() =>
    initialModel
      ? { status: "ready", model: initialModel }
      : { status: "loading" },
  );

  useEffect(() => {
    if (initialModel) return;

    const controller = new AbortController();
    void fetch("/api/dashboard", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as DashboardResponse;
        if (!response.ok || !payload.ok) throw new Error("Dashboard request failed");
        const model = hydrateDashboardModel(payload.model);
        if (Number.isNaN(model.date.getTime())) throw new Error("Dashboard date is invalid");
        if (controller.signal.aborted) return;
        setState({ status: "ready", model });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      });

    return () => controller.abort();
  }, [attempt, initialModel]);

  if (state.status === "loading") {
    return (
      <div
        className="workspace-pane-page__state workspace-pane-page__state--loading"
        role="status"
        aria-live="polite"
        aria-label="Dashboard is loading"
      >
        <SkeletonRows count={6} className="workspace-pane-page__skeleton" />
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div
        className="workspace-pane-page__state workspace-pane-page__state--unavailable"
        role="status"
        aria-live="polite"
      >
        <div className="workspace-pane-page__state-copy">
          <p className="workspace-pane-page__state-title">Dashboard is unavailable</p>
          <p className="workspace-pane-page__state-description">
            The latest dashboard data could not be loaded.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return <DashboardCockpit model={state.model} />;
}
