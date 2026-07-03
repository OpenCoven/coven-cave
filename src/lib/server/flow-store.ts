// Server-side disk store for the Flow editor.
//
// Flows are JSON documents under `~/.coven/flows/<id>.json`; run history lives
// in `~/.coven/flow-runs.json` (newest-first, capped). Atomic writes (unique
// temp + rename) keep concurrent writers — desktop, daemon, iOS — from
// clobbering each other. Mirrors workflow-source.ts / workflow-runs.ts.

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.ts";
import { FLOW_SCHEMA_VERSION, normalizeNodeSettings, type FlowDoc, type FlowEdge, type FlowNodeSettings } from "../flow/flow-doc.ts";
import type { FlowRunRecord } from "../flows.ts";

export const FLOW_RUNS_CAP = 200;

function flowsDir(): string {
  const override = process.env.COVEN_FLOWS_DIR?.trim();
  if (override) return override;
  return path.join(homedir(), ".coven", "flows");
}

function runsPath(): string {
  const override = process.env.COVEN_FLOW_RUNS_PATH?.trim();
  if (override) return override;
  return path.join(homedir(), ".coven", "flow-runs.json");
}

/** A safe, traversal-proof filename for a flow id. */
function flowFileName(id: string): string {
  // Ids come from slugifyFlowId on the client, but never trust that here:
  // strip anything but the slug alphabet so a crafted id can't escape the dir.
  const safe = id.replace(/[^a-z0-9._-]/gi, "").replace(/^\.+/, "");
  return `${safe || "flow"}.json`;
}

function isValidDoc(value: unknown): value is FlowDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<FlowDoc>;
  return typeof doc.id === "string" && Array.isArray(doc.nodes) && Array.isArray(doc.edges);
}

function coerceDoc(value: unknown): FlowDoc | null {
  if (!isValidDoc(value)) return null;
  const now = new Date().toISOString();
  const nodes = coerceFlowNodes(value.nodes);
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : value.id,
    active: Boolean(value.active),
    published: coercePublished(value.published),
    executionData: coerceExecutionData(value.executionData),
    nodes,
    edges: coerceFlowEdges(value.edges, nodes),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    schema: typeof value.schema === "number" ? value.schema : FLOW_SCHEMA_VERSION,
  };
}

function coerceFlowNodes(value: unknown): FlowDoc["nodes"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((node) => node && typeof node === "object" && !Array.isArray(node))
    .map((node): Record<string, unknown> => {
      const record = node as Record<string, unknown>;
      const settings = coerceNodeSettings(record.settings);
      const displayNote = record.displayNote === true;
      const disabled = record.disabled === true;
      const { settings: _settings, displayNote: _displayNote, disabled: _disabled, ...rest } = record;
      const next: Record<string, unknown> = { ...rest };
      if (settings) next.settings = settings;
      if (displayNote) next.displayNote = true;
      if (disabled) next.disabled = true;
      return next;
    })
    .filter((node): node is FlowDoc["nodes"][number] => (
      typeof node.id === "string" &&
      typeof node.type === "string" &&
      typeof node.name === "string" &&
      Boolean(node.position) &&
      typeof node.position === "object" &&
      typeof node.params === "object" &&
      node.params !== null
    ));
}

// Edges are validated against the coerced node set: an edge whose shape is
// malformed, or whose source/target references a node that didn't survive
// coercion, is dropped rather than persisted as a dangling reference that the
// canvas and executor would otherwise have to skip on every load.
function coerceFlowEdges(value: unknown, nodes: FlowDoc["nodes"]): FlowEdge[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(nodes.map((node) => node.id));
  return value.filter((edge): edge is FlowEdge => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) return false;
    const e = edge as Record<string, unknown>;
    return (
      typeof e.id === "string" &&
      typeof e.source === "string" &&
      typeof e.sourceHandle === "string" &&
      typeof e.target === "string" &&
      typeof e.targetHandle === "string" &&
      ids.has(e.source) &&
      ids.has(e.target)
    );
  });
}

function coerceNodeSettings(value: unknown): FlowNodeSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<FlowNodeSettings>;
  return normalizeNodeSettings({
    alwaysOutputData: raw.alwaysOutputData,
    executeOnce: raw.executeOnce,
    retryOnFail: raw.retryOnFail,
    maxTries: raw.maxTries,
    onError: raw.onError,
  });
}

function coerceExecutionData(value: unknown): FlowDoc["executionData"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as FlowDoc["executionData"];
  const next: NonNullable<FlowDoc["executionData"]> = {};
  if (data?.redactManual === true) next.redactManual = true;
  if (data?.redactProduction === true) next.redactProduction = true;
  return Object.keys(next).length > 0 ? next : undefined;
}

function coercePublished(value: unknown): FlowDoc["published"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const published = value as Partial<NonNullable<FlowDoc["published"]>>;
  const snapshot = published.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const doc = snapshot as Partial<FlowDoc>;
  if (typeof published.publishedAt !== "string" || typeof doc.id !== "string") return undefined;
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return undefined;
  const now = new Date().toISOString();
  const nodes = coerceFlowNodes(doc.nodes);
  return {
    publishedAt: published.publishedAt,
    snapshot: {
      id: doc.id,
      name: typeof doc.name === "string" && doc.name.trim() ? doc.name : doc.id,
      active: Boolean(doc.active),
      executionData: coerceExecutionData(doc.executionData),
      nodes,
      edges: coerceFlowEdges(doc.edges, nodes),
      createdAt: typeof doc.createdAt === "string" ? doc.createdAt : now,
      updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : now,
      schema: typeof doc.schema === "number" ? doc.schema : FLOW_SCHEMA_VERSION,
    },
  };
}

export async function listFlows(): Promise<FlowDoc[]> {
  let entries: string[];
  try {
    entries = await readdir(flowsDir());
  } catch {
    return [];
  }
  const flows: FlowDoc[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const text = await readFile(path.join(flowsDir(), entry), "utf8");
      const doc = coerceDoc(JSON.parse(text));
      if (doc) flows.push(doc);
    } catch {
      // Skip an unreadable/corrupt flow rather than failing the whole list.
    }
  }
  flows.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
  return flows;
}

export async function loadFlow(id: string): Promise<FlowDoc | null> {
  try {
    const text = await readFile(path.join(flowsDir(), flowFileName(id)), "utf8");
    return coerceDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function saveFlow(input: FlowDoc): Promise<FlowDoc> {
  const doc = coerceDoc(input);
  if (!doc) throw new Error("invalid flow document");
  const now = new Date().toISOString();
  const saved: FlowDoc = { ...doc, updatedAt: now };
  await mkdir(flowsDir(), { recursive: true });
  await writeJsonAtomic(path.join(flowsDir(), flowFileName(saved.id)), saved);
  return saved;
}

export async function deleteFlow(id: string): Promise<boolean> {
  try {
    await rm(path.join(flowsDir(), flowFileName(id)), { force: true });
    return true;
  } catch {
    return false;
  }
}

// ---- Run history -----------------------------------------------------------

type RunsFile = { version: 1; runs: FlowRunRecord[] };

async function loadRunsFile(): Promise<RunsFile> {
  try {
    const text = await readFile(runsPath(), "utf8");
    const parsed = JSON.parse(text) as RunsFile;
    if (parsed && Array.isArray(parsed.runs)) return { version: 1, runs: parsed.runs };
  } catch {
    // Missing/corrupt reads as empty; the next write rebuilds it.
  }
  return { version: 1, runs: [] };
}

let runsWriteChain: Promise<unknown> = Promise.resolve();
function withRunsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = runsWriteChain.then(fn, fn);
  runsWriteChain = next.catch(() => undefined);
  return next;
}

export async function recordFlowRun(input: Omit<FlowRunRecord, "id">): Promise<FlowRunRecord> {
  const record: FlowRunRecord = { ...input, id: randomUUID() };
  await withRunsLock(async () => {
    const file = await loadRunsFile();
    file.runs.unshift(record);
    if (file.runs.length > FLOW_RUNS_CAP) file.runs.length = FLOW_RUNS_CAP;
    await mkdir(path.dirname(runsPath()), { recursive: true });
    await writeJsonAtomic(runsPath(), file);
  });
  return record;
}

export async function listFlowRuns(flowId?: string): Promise<FlowRunRecord[]> {
  const file = await loadRunsFile();
  if (!flowId) return file.runs;
  return file.runs.filter((run) => run.flowId === flowId);
}

/**
 * Patch an existing run in place (status/steps/finishedAt as a run finishes).
 * The run id is immutable; everything else is shallow-merged. Returns the
 * updated record, or null if no run matched.
 */
export async function updateFlowRun(
  id: string,
  patch: Partial<Omit<FlowRunRecord, "id">>,
): Promise<FlowRunRecord | null> {
  return withRunsLock(async () => {
    const file = await loadRunsFile();
    const index = file.runs.findIndex((run) => run.id === id);
    if (index < 0) return null;
    const updated: FlowRunRecord = { ...file.runs[index], ...patch, id };
    file.runs[index] = updated;
    await mkdir(path.dirname(runsPath()), { recursive: true });
    await writeJsonAtomic(runsPath(), file);
    return updated;
  });
}

export async function clearFlowRuns(flowId?: string): Promise<number> {
  return withRunsLock(async () => {
    const file = await loadRunsFile();
    const before = file.runs.length;
    file.runs = flowId ? file.runs.filter((run) => run.flowId !== flowId) : [];
    await mkdir(path.dirname(runsPath()), { recursive: true });
    await writeJsonAtomic(runsPath(), file);
    return before - file.runs.length;
  });
}
