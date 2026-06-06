"use client";

import { useState } from "react";
import { TraceGraph3D } from "@/components/trace-graph-3d";
import type { DelegationGraph } from "@/lib/coven-calls-types";
import type { Familiar } from "@/lib/types";
import type { TraceGraphSelection } from "@/components/trace-graph-3d-model";

const now = new Date().toISOString();

const graph: DelegationGraph = {
  nodes: [
    {
      id: "nova",
      sentCount: 2,
      receivedCount: 1,
      sentExplicitCount: 2,
      receivedExplicitCount: 1,
      sentInferredCount: 0,
      receivedInferredCount: 0,
      hasRunningReceived: false,
      latestReceivedFailed: false,
      lastSeenAt: now,
    },
    {
      id: "cody",
      sentCount: 1,
      receivedCount: 2,
      sentExplicitCount: 1,
      receivedExplicitCount: 1,
      sentInferredCount: 0,
      receivedInferredCount: 1,
      hasRunningReceived: true,
      latestReceivedFailed: false,
      lastSeenAt: now,
    },
    {
      id: "sage",
      sentCount: 0,
      receivedCount: 1,
      sentExplicitCount: 0,
      receivedExplicitCount: 0,
      sentInferredCount: 0,
      receivedInferredCount: 1,
      hasRunningReceived: false,
      latestReceivedFailed: true,
      lastSeenAt: now,
    },
  ],
  edges: [
    {
      caller: "nova",
      callee: "cody",
      count: 2,
      explicitCount: 2,
      inferredCount: 0,
      source: "explicit",
      mostRecentRequest: "Build the 3D trace graph",
      hasRunning: true,
      latestStatus: "running",
      lastSeenAt: now,
      traces: [
        {
          id: "smoke-trace-1",
          callerFamiliarId: "nova",
          calleeFamiliarId: "cody",
          request: "Build the 3D trace graph",
          status: "running",
          createdAt: now,
          source: "explicit",
          sessionId: "smoke-session-cody",
        },
      ],
    },
    {
      caller: "cody",
      callee: "sage",
      count: 1,
      explicitCount: 0,
      inferredCount: 1,
      source: "inferred",
      mostRecentRequest: "Research graph behavior",
      hasRunning: false,
      latestStatus: "failed",
      lastSeenAt: now,
      traces: [
        {
          id: "smoke-trace-2",
          callerFamiliarId: "cody",
          calleeFamiliarId: "sage",
          request: "Research graph behavior",
          status: "failed",
          createdAt: now,
          source: "inferred",
          inferenceReason: "Fixture trace for canvas verification.",
        },
      ],
    },
  ],
  traces: [
    {
      id: "smoke-trace-1",
      callerFamiliarId: "nova",
      calleeFamiliarId: "cody",
      request: "Build the 3D trace graph",
      status: "running",
      createdAt: now,
      source: "explicit",
      sessionId: "smoke-session-cody",
    },
    {
      id: "smoke-trace-2",
      callerFamiliarId: "cody",
      calleeFamiliarId: "sage",
      request: "Research graph behavior",
      status: "failed",
      createdAt: now,
      source: "inferred",
      inferenceReason: "Fixture trace for canvas verification.",
    },
  ],
};

const familiars = new Map<string, Familiar>([
  ["nova", { id: "nova", display_name: "Nova", role: "Guide", emoji: "N" }],
  ["cody", { id: "cody", display_name: "Cody", role: "Builder", emoji: "C" }],
  ["sage", { id: "sage", display_name: "Sage", role: "Researcher", emoji: "S" }],
]);

export function TraceGraph3DSmoke() {
  const [selection, setSelection] = useState<TraceGraphSelection>(null);
  return (
    <main className="h-screen w-screen bg-[var(--bg-base)] p-6 text-[var(--text-primary)]">
      <div className="h-full overflow-hidden border border-[var(--border-hairline)]">
        <TraceGraph3D graph={graph} familiars={familiars} selection={selection} onSelect={setSelection} />
      </div>
    </main>
  );
}
