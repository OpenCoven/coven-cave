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

export type DelegationTraceSource = "explicit" | "inferred";

export type DelegationTrace = CovenCall & {
  source: DelegationTraceSource;
  inferenceReason?: string;
  linkedCardId?: string;
};

export type DelegationGraphEdge = {
  caller: string;
  callee: string;
  count: number;
  explicitCount: number;
  inferredCount: number;
  source: DelegationTraceSource | "mixed";
  mostRecentRequest: string;
  hasRunning: boolean;
  latestStatus: CallStatus;
  lastSeenAt: string;
  traces: DelegationTrace[];
};

export type DelegationGraphNode = {
  id: string;
  sentCount: number;
  receivedCount: number;
  sentExplicitCount: number;
  receivedExplicitCount: number;
  sentInferredCount: number;
  receivedInferredCount: number;
  hasRunningReceived: boolean;
  latestReceivedFailed: boolean;
  lastSeenAt: string;
};

export type DelegationGraph = {
  edges: DelegationGraphEdge[];
  nodes: DelegationGraphNode[];
  traces: DelegationTrace[];
};

type InferenceCard = {
  id: string;
  title: string;
  status?: string;
  lifecycle?: string;
  familiarId?: string | null;
  sessionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type InferenceSession = {
  id: string;
  title?: string;
  status?: string;
  familiarId?: string | null;
  created_at?: string;
  updated_at?: string;
  initiator?: {
    kind: "human" | "familiar" | "system" | "unknown";
    label: string;
    agentId?: string;
  };
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

function statusFromCard(card: InferenceCard): CallStatus {
  if (card.lifecycle === "failed" || card.status === "blocked") return "failed";
  if (card.lifecycle === "cancelled") return "cancelled";
  if (card.lifecycle === "completed" || card.status === "done") return "completed";
  return "running";
}

function statusFromSession(session: InferenceSession): CallStatus {
  if (session.status === "failed" || session.status === "timeout") return "failed";
  if (session.status === "cancelled" || session.status === "killed" || session.status === "stopped") {
    return "cancelled";
  }
  if (session.status === "completed" || session.status === "done") return "completed";
  return "running";
}

function asExplicitTrace(call: CovenCall): DelegationTrace {
  return { ...call, source: "explicit" };
}

export function inferDelegationTraces({
  cards,
  sessions,
}: {
  cards: InferenceCard[];
  sessions: InferenceSession[];
}): DelegationTrace[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const traces: DelegationTrace[] = [];

  for (const card of cards) {
    if (!card.familiarId || !card.sessionId) continue;
    const session = sessionById.get(card.sessionId);
    if (!session?.familiarId) continue;
    if (session.familiarId === card.familiarId) continue;

    const createdAt =
      card.updatedAt ??
      card.createdAt ??
      session.updated_at ??
      session.created_at ??
      new Date(0).toISOString();

    traces.push({
      id: `inferred-card-${card.id}`,
      callerFamiliarId: session.familiarId,
      calleeFamiliarId: card.familiarId,
      request: `Task handoff inferred from linked card: ${card.title}`,
      status: statusFromCard(card),
      createdAt,
      sessionId: card.sessionId,
      source: "inferred",
      linkedCardId: card.id,
      inferenceReason:
        "A task card is assigned to one familiar while linked to a session owned by another familiar.",
    });
  }

  for (const session of sessions) {
    const callerFamiliarId = session.initiator?.kind === "familiar"
      ? session.initiator.agentId
      : undefined;
    const calleeFamiliarId = session.familiarId ?? undefined;
    if (!callerFamiliarId || !calleeFamiliarId) continue;
    if (callerFamiliarId === calleeFamiliarId) continue;

    const createdAt =
      session.updated_at ??
      session.created_at ??
      new Date(0).toISOString();
    const title = session.title?.trim() || session.id;

    traces.push({
      id: `inferred-session-${session.id}`,
      callerFamiliarId,
      calleeFamiliarId,
      request: `Conversation inferred from session initiator: ${title}`,
      status: statusFromSession(session),
      createdAt,
      sessionId: session.id,
      source: "inferred",
      inferenceReason:
        "A session is owned by one familiar but was started by another familiar.",
    });
  }

  return traces.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function buildDelegationGraph({
  explicitCalls,
  inferredTraces = [],
  includeInferred = true,
}: {
  explicitCalls: CovenCall[];
  inferredTraces?: DelegationTrace[];
  includeInferred?: boolean;
}): DelegationGraph {
  const traces = [
    ...explicitCalls.map(asExplicitTrace),
    ...(includeInferred ? inferredTraces : []),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const edgeMap = new Map<string, DelegationGraphEdge>();
  const nodeMap = new Map<string, DelegationGraphNode>();
  const latestReceivedSeen = new Set<string>();

  const ensureNode = (id: string): DelegationGraphNode => {
    const existing = nodeMap.get(id);
    if (existing) return existing;
    const node: DelegationGraphNode = {
      id,
      sentCount: 0,
      receivedCount: 0,
      sentExplicitCount: 0,
      receivedExplicitCount: 0,
      sentInferredCount: 0,
      receivedInferredCount: 0,
      hasRunningReceived: false,
      latestReceivedFailed: false,
      lastSeenAt: "",
    };
    nodeMap.set(id, node);
    return node;
  };

  for (const trace of traces) {
    const caller = ensureNode(trace.callerFamiliarId);
    const callee = ensureNode(trace.calleeFamiliarId);
    caller.sentCount += 1;
    callee.receivedCount += 1;
    if (trace.source === "explicit") {
      caller.sentExplicitCount += 1;
      callee.receivedExplicitCount += 1;
    } else {
      caller.sentInferredCount += 1;
      callee.receivedInferredCount += 1;
    }
    if (!caller.lastSeenAt || trace.createdAt > caller.lastSeenAt) caller.lastSeenAt = trace.createdAt;
    if (!callee.lastSeenAt || trace.createdAt > callee.lastSeenAt) callee.lastSeenAt = trace.createdAt;
    if (trace.status === "running") callee.hasRunningReceived = true;
    if (!latestReceivedSeen.has(trace.calleeFamiliarId)) {
      latestReceivedSeen.add(trace.calleeFamiliarId);
      callee.latestReceivedFailed = trace.status === "failed";
    }

    const key = `${trace.callerFamiliarId}->${trace.calleeFamiliarId}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.traces.push(trace);
      if (trace.source === "explicit") existing.explicitCount += 1;
      else existing.inferredCount += 1;
      existing.source =
        existing.explicitCount > 0 && existing.inferredCount > 0
          ? "mixed"
          : existing.explicitCount > 0
          ? "explicit"
          : "inferred";
      if (trace.createdAt > existing.lastSeenAt) {
        existing.lastSeenAt = trace.createdAt;
        existing.mostRecentRequest = trace.request;
        existing.latestStatus = trace.status;
      }
      if (trace.status === "running") existing.hasRunning = true;
    } else {
      edgeMap.set(key, {
        caller: trace.callerFamiliarId,
        callee: trace.calleeFamiliarId,
        count: 1,
        explicitCount: trace.source === "explicit" ? 1 : 0,
        inferredCount: trace.source === "inferred" ? 1 : 0,
        source: trace.source,
        mostRecentRequest: trace.request,
        hasRunning: trace.status === "running",
        latestStatus: trace.status,
        lastSeenAt: trace.createdAt,
        traces: [trace],
      });
    }
  }

  return {
    edges: Array.from(edgeMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    }),
    nodes: Array.from(nodeMap.values()).sort(
      (a, b) => b.sentCount + b.receivedCount - (a.sentCount + a.receivedCount),
    ),
    traces,
  };
}
