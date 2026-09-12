export type FlowSessionReference = {
  flowId: string;
  runId: string;
  missionId?: string;
  iteration?: number;
};

export function isUnstartedFlowDiscussion(conversation: {
  flowDiscussion?: FlowSessionReference;
  harnessSessionId?: string;
} | null | undefined): boolean {
  return Boolean(conversation?.flowDiscussion && !conversation.harnessSessionId);
}

export function flowSessionReferenceFor(
  references: Record<string, FlowSessionReference> | undefined,
  sessionId: string,
): FlowSessionReference | undefined {
  return references && Object.hasOwn(references, sessionId) ? references[sessionId] : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function sessionKey(value: unknown): value is string {
  return identifier(value) && value.length <= 240 &&
    value !== "." && value !== ".." && !/[/\\\0]/.test(value);
}

function reference(value: unknown): FlowSessionReference | null {
  if (!record(value) || !identifier(value.flowId) || !identifier(value.runId)) return null;
  if (value.missionId !== undefined && !identifier(value.missionId)) return null;
  if (value.iteration !== undefined &&
      (typeof value.iteration !== "number" || !Number.isSafeInteger(value.iteration) || value.iteration < 1)) return null;
  return {
    flowId: value.flowId,
    runId: value.runId,
    ...(typeof value.missionId === "string" ? { missionId: value.missionId } : {}),
    ...(typeof value.iteration === "number" ? { iteration: value.iteration } : {}),
  };
}

/** Uncertain stored provenance must never hide an ordinary conversation. */
export function normalizeFlowSessionReferences(value: unknown): Record<string, FlowSessionReference> {
  if (value === undefined) return {};
  if (!record(value)) {
    console.warn("[flow-sessions] Ignoring malformed ownership index");
    return {};
  }
  const entries: [string, FlowSessionReference][] = [];
  for (const [id, candidate] of Object.entries(value)) {
    const owner = reference(candidate);
    if (sessionKey(id) && owner) entries.push([id, owner]);
    else console.warn("[flow-sessions] Ignoring malformed session ownership:", id);
  }
  return Object.fromEntries(entries);
}

export function normalizeFlowSessionCompletions(value: unknown): Record<string, boolean> {
  if (value === undefined) return {};
  if (!record(value)) {
    console.warn("[flow-sessions] Ignoring malformed completion index");
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => {
    const [id, completed] = entry;
    if (sessionKey(id) && typeof completed === "boolean") return true;
    console.warn("[flow-sessions] Ignoring malformed completion:", id);
    return false;
  }));
}

export function flowSessionOwnership(runs: readonly unknown[]): { references: Record<string, FlowSessionReference>; ambiguous: string[] } {
  const references = new Map<string, FlowSessionReference>();
  const ambiguous = new Set<string>();
  for (const run of runs) {
    if (!record(run) || !sessionKey(run.sessionId)) continue;
    const owner = reference({ ...run, runId: run.id });
    if (!owner) continue;
    const previous = references.get(run.sessionId);
    if (previous && (previous.runId !== owner.runId || previous.flowId !== owner.flowId ||
        previous.missionId !== owner.missionId || previous.iteration !== owner.iteration)) {
      ambiguous.add(run.sessionId);
    }
    references.set(run.sessionId, owner);
  }
  for (const id of ambiguous) references.delete(id);
  return { references: Object.fromEntries(references), ambiguous: [...ambiguous] };
}

export function flowSessionReferences(runs: readonly unknown[]): Record<string, FlowSessionReference> {
  return flowSessionOwnership(runs).references;
}

export function flowSessionCompletions(runs: readonly unknown[]): Record<string, boolean> {
  const references = flowSessionReferences(runs);
  return Object.fromEntries(runs.flatMap((run) => {
    if (!record(run) || typeof run.sessionId !== "string" ||
        !flowSessionReferenceFor(references, run.sessionId)) return [];
    return [[run.sessionId, run.status !== "running" && run.status !== "queued"]];
  }));
}
