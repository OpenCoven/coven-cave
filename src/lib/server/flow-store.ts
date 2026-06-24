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
import { FLOW_SCHEMA_VERSION, type FlowDoc } from "../flow/flow-doc.ts";
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
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : value.id,
    active: Boolean(value.active),
    nodes: value.nodes,
    edges: value.edges,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    schema: typeof value.schema === "number" ? value.schema : FLOW_SCHEMA_VERSION,
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
