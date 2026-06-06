// Pure types + pure-function helpers for Coven Calls — extracted out of
// coven-calls.ts so client components can import without dragging
// node:fs/promises into the browser bundle. Same split-pattern as
// escalations-types vs escalations.

export type CallStatus = "running" | "completed" | "failed" | "cancelled";

export type CovenCall = {
  id: string;
  callerFamiliarId: string;
  calleeFamiliarId: string;
  request: string;
  artifact?: string;
  status: CallStatus;
  createdAt: string;
  endedAt?: string;
  sessionId?: string;
};

export type CovenCallInput = {
  callerFamiliarId: string;
  calleeFamiliarId: string;
  request: string;
  sessionId?: string;
};

export type CallEdge = {
  caller: string;
  callee: string;
  count: number;
  /** Verbatim request from the most recent call on this edge. */
  mostRecentRequest: string;
  /** True when any call on this edge has status "running". */
  hasRunning: boolean;
};

export function aggregateEdges(calls: CovenCall[]): CallEdge[] {
  const map = new Map<string, CallEdge>();
  const sorted = [...calls].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (const c of sorted) {
    const key = `${c.callerFamiliarId}->${c.calleeFamiliarId}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.mostRecentRequest = c.request;
      if (c.status === "running") existing.hasRunning = true;
    } else {
      map.set(key, {
        caller: c.callerFamiliarId,
        callee: c.calleeFamiliarId,
        count: 1,
        mostRecentRequest: c.request,
        hasRunning: c.status === "running",
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
