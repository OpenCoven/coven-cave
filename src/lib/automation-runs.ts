import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Local run-history store for Codex automations — records app-triggered
 * "run now" executions (the daemon's scheduled runs are separate). Newest-first,
 * capped, JSON on disk. Path: `~/.coven/cave-automation-runs.json`, overridable
 * via `COVEN_AUTOMATION_RUNS_PATH` (tests).
 */
export const AUTOMATION_RUNS_CAP = 200;

export type AutomationRunStatus = "running" | "succeeded" | "failed";
export type AutomationRunRecord = {
  id: string;
  automationId: string;
  automationName: string;
  startedAt: string;
  finishedAt?: string;
  status: AutomationRunStatus;
  exitCode?: number;
  summary?: string;
  logPath?: string;
};

type RunsFile = { version: 1; runs: AutomationRunRecord[] };

function runsPath(): string {
  const override = process.env.COVEN_AUTOMATION_RUNS_PATH?.trim();
  if (override) return override;
  return path.join(homedir(), ".coven", "cave-automation-runs.json");
}

async function loadRunsFile(): Promise<RunsFile> {
  try {
    const text = await readFile(runsPath(), "utf8");
    const parsed = JSON.parse(text) as RunsFile;
    if (parsed && Array.isArray(parsed.runs)) return { version: 1, runs: parsed.runs };
  } catch {
    // missing/corrupt → empty
  }
  return { version: 1, runs: [] };
}

let runsWriteChain: Promise<unknown> = Promise.resolve();
function withRunsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = runsWriteChain.then(fn, fn);
  runsWriteChain = next.catch(() => undefined);
  return next;
}

async function persist(file: RunsFile): Promise<void> {
  await mkdir(path.dirname(runsPath()), { recursive: true });
  await writeFile(runsPath(), JSON.stringify(file, null, 2), "utf8");
}

export async function recordRun(input: Omit<AutomationRunRecord, "id">): Promise<AutomationRunRecord> {
  const record: AutomationRunRecord = { ...input, id: randomUUID() };
  await withRunsLock(async () => {
    const file = await loadRunsFile();
    file.runs.unshift(record);
    if (file.runs.length > AUTOMATION_RUNS_CAP) file.runs.length = AUTOMATION_RUNS_CAP;
    await persist(file);
  });
  return record;
}

export async function updateRun(
  id: string,
  patch: Partial<Omit<AutomationRunRecord, "id">>,
): Promise<AutomationRunRecord | null> {
  return withRunsLock(async () => {
    const file = await loadRunsFile();
    const run = file.runs.find((r) => r.id === id);
    if (!run) return null;
    Object.assign(run, patch);
    await persist(file);
    return run;
  });
}

export async function listRuns(automationId?: string): Promise<AutomationRunRecord[]> {
  const file = await loadRunsFile();
  return automationId ? file.runs.filter((r) => r.automationId === automationId) : file.runs;
}

export async function latestRun(automationId: string): Promise<AutomationRunRecord | null> {
  const file = await loadRunsFile();
  return file.runs.find((r) => r.automationId === automationId) ?? null;
}

export async function hasRunningRun(automationId: string): Promise<boolean> {
  const file = await loadRunsFile();
  return file.runs.some((r) => r.automationId === automationId && r.status === "running");
}
