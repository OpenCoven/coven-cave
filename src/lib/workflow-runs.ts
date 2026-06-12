import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { covenHome } from "./coven-paths.ts";

/**
 * Local run-history store for the Workflow Studio. The daemon has no workflow
 * engine yet, so Cave records what actually happened on this machine: dry-run
 * plan snapshots today, daemon executions once the engine lands (the run proxy
 * appends to the same store). Newest-first, capped, JSON on disk.
 *
 * Path: `~/.coven/workflow-runs.json`, overridable via
 * `COVEN_WORKFLOW_RUNS_PATH` (tests).
 */

export const RUNS_HISTORY_CAP = 200;

export type WorkflowRunStatus = "plan" | "queued" | "running" | "succeeded" | "failed" | "blocked";

export type WorkflowRunStepRecord = {
  id: string;
  kind: string;
  status: "ready" | "blocked" | "succeeded" | "failed" | "skipped";
};

export type WorkflowRunRecord = {
  id: string;
  workflowId: string;
  version?: string;
  kind: "dry-run" | "execution";
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: WorkflowRunStepRecord[];
  summary?: string;
  source: "cave" | "daemon";
};

type RunsFile = { version: 1; runs: WorkflowRunRecord[] };

function runsPath(): string {
  const override = process.env.COVEN_WORKFLOW_RUNS_PATH?.trim();
  if (override) return override;
  return path.join(covenHome(), "workflow-runs.json");
}

async function loadRunsFile(): Promise<RunsFile> {
  try {
    const text = await readFile(runsPath(), "utf8");
    const parsed = JSON.parse(text) as RunsFile;
    if (parsed && Array.isArray(parsed.runs)) return { version: 1, runs: parsed.runs };
  } catch {
    // Missing or corrupt store reads as empty; the next write rebuilds it.
  }
  return { version: 1, runs: [] };
}

// Writes are serialized through a promise chain (same pattern as cave-inbox)
// so concurrent records cannot clobber each other.
let runsWriteChain: Promise<unknown> = Promise.resolve();
function withRunsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = runsWriteChain.then(fn, fn);
  runsWriteChain = next.catch(() => undefined);
  return next;
}

/** Append a run record (newest first) and return it with its assigned id. */
export async function recordRun(input: Omit<WorkflowRunRecord, "id">): Promise<WorkflowRunRecord> {
  const record: WorkflowRunRecord = { ...input, id: randomUUID() };
  await withRunsLock(async () => {
    const file = await loadRunsFile();
    file.runs.unshift(record);
    if (file.runs.length > RUNS_HISTORY_CAP) file.runs.length = RUNS_HISTORY_CAP;
    await mkdir(path.dirname(runsPath()), { recursive: true });
    await writeFile(runsPath(), JSON.stringify(file, null, 2), "utf8");
  });
  return record;
}

/** Newest-first run records, optionally filtered to one workflow. */
export async function listRuns(workflowId?: string): Promise<WorkflowRunRecord[]> {
  const file = await loadRunsFile();
  if (!workflowId) return file.runs;
  return file.runs.filter((run) => run.workflowId === workflowId);
}
