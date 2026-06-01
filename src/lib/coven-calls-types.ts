// Pure types + pure-function helpers for Coven Calls — extracted out of
// coven-calls.ts so client components can import without dragging
// node:fs/promises into the browser bundle. Same split-pattern as
// vals-inbox-types vs vals-inbox.

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
};

export function aggregateEdges(calls: CovenCall[]): CallEdge[] {
  const map = new Map<string, CallEdge>();
  for (const c of calls) {
    const key = `${c.callerFamiliarId}->${c.calleeFamiliarId}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else
      map.set(key, {
        caller: c.callerFamiliarId,
        callee: c.calleeFamiliarId,
        count: 1,
      });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
