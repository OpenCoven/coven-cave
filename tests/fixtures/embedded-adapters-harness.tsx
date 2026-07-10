import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardSurface } from "@/components/dashboard/dashboard-surface";
import type { DashboardModel } from "@/lib/dashboard-model";

type SeedName = "A" | "B" | "C";

type PendingDashboardRequest = {
  signal: AbortSignal | undefined;
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
};

const MODEL_DATES: Record<SeedName | "Fetched D", string> = {
  A: "2026-07-10T01:00:00.000Z",
  B: "2026-07-10T02:00:00.000Z",
  C: "2026-07-10T03:00:00.000Z",
  "Fetched D": "2026-07-10T04:00:00.000Z",
};

function dashboardModel(name: SeedName): DashboardModel {
  return {
    date: new Date(MODEL_DATES[name]),
    caughtUp: true,
    needsAttention: [],
    todaySummary: null,
    featuredReport: null,
    recentReports: [],
  };
}

function dashboardWireResponse(name: "Fetched D"): Response {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      model: {
        ...dashboardModel("A"),
        date: MODEL_DATES[name],
      },
    }),
  } as Response;
}

function EmbeddedAdaptersHarness() {
  const [seed, setSeed] = useState<SeedName | null>("A");
  const [pendingRequests, setPendingRequests] = useState<PendingDashboardRequest[]>([]);

  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      setPendingRequests((current) => [
        ...current,
        { signal: init?.signal ?? undefined, resolve, reject },
      ]);
    })) as typeof fetch;

  const settleOldest = (settle: (request: PendingDashboardRequest) => void) => {
    setPendingRequests((current) => {
      const [oldest, ...rest] = current;
      if (oldest) settle(oldest);
      return rest;
    });
  };

  return (
    <main>
      <div aria-label="Dashboard lifecycle controls">
        <button type="button" onClick={() => setSeed("A")}>Seed A</button>
        <button type="button" onClick={() => setSeed("B")}>Seed B</button>
        <button type="button" onClick={() => setSeed("C")}>Seed C</button>
        <button type="button" onClick={() => setSeed(null)}>Unseed</button>
        <button
          type="button"
          onClick={() => settleOldest((request) => request.resolve(dashboardWireResponse("Fetched D")))}
        >
          Resolve oldest as Fetched D
        </button>
        <button
          type="button"
          onClick={() => settleOldest((request) => request.reject(new Error("fixture failure")))}
        >
          Reject oldest
        </button>
        <output aria-label="Pending dashboard requests">{pendingRequests.length}</output>
      </div>

      <DashboardSurface initialModel={seed ? dashboardModel(seed) : undefined} />
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing embedded adapters harness root");

createRoot(rootElement).render(
  <StrictMode>
    <EmbeddedAdaptersHarness />
  </StrictMode>,
);
