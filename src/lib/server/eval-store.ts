// Server-side disk store for Familiar Evals.
//
// Suites are JSON documents under `~/.coven/evals/suites/<id>.json`; completed
// run records live under `~/.coven/evals/runs/<id>.json` (one file per run).
// Atomic writes (unique temp + rename, via writeJsonAtomic) keep concurrent
// writers from clobbering each other. Mirrors flow-store.ts.

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.ts";
import {
  buildManualEvalQueueItems,
  summarizeResults,
  type EvalGroup,
  type EvalSuite,
  type EvalCase,
  type EvalRun,
  type Grader,
  type GraderKind,
  type ManualEvalQueueItem,
  type ThreadEvalSnapshot,
  type ThreadEvalState,
} from "../evals/eval-model.ts";

export const EVAL_RUNS_CAP = 200;

function evalsRoot(): string {
  const override = process.env.COVEN_EVALS_DIR?.trim();
  if (override) return override;
  return path.join(homedir(), ".coven", "evals");
}
function suitesDir(): string {
  return path.join(evalsRoot(), "suites");
}
function runsDir(): string {
  return path.join(evalsRoot(), "runs");
}
function groupsDir(): string {
  return path.join(evalsRoot(), "groups");
}
function threadStatesDir(): string {
  return path.join(evalsRoot(), "thread-states");
}
function queueDir(): string {
  return path.join(evalsRoot(), "queue");
}

/** Traversal-proof filename for an id (suites and runs share the rule). */
function fileName(id: string, fallback: string): string {
  const safe = id.replace(/[^a-z0-9._-]/gi, "").replace(/^\.+/, "");
  return `${safe || fallback}.json`;
}

const GRADER_KINDS: GraderKind[] = [
  "contains",
  "not_contains",
  "regex",
  "equals",
  "json_has",
  "latency_under",
  "llm_judge",
];

function coerceGrader(value: unknown): Grader | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  if (typeof g.kind !== "string" || !GRADER_KINDS.includes(g.kind as GraderKind)) return null;
  return {
    kind: g.kind as GraderKind,
    value: typeof g.value === "string" ? g.value : "",
    caseInsensitive: g.caseInsensitive === true,
    rubric: typeof g.rubric === "string" ? g.rubric : undefined,
    label: typeof g.label === "string" ? g.label : undefined,
  };
}

function coerceCase(value: unknown): EvalCase | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string") return null;
  const graders = Array.isArray(c.graders)
    ? c.graders.map(coerceGrader).filter((g): g is Grader => g !== null)
    : [];
  return {
    id: c.id,
    name: typeof c.name === "string" ? c.name : "Untitled case",
    input: typeof c.input === "string" ? c.input : "",
    graders,
  };
}

function coerceSuite(value: unknown): EvalSuite | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string") return null;
  const now = new Date().toISOString();
  return {
    id: s.id,
    name: typeof s.name === "string" && s.name.trim() ? s.name : s.id,
    description: typeof s.description === "string" ? s.description : undefined,
    slaMinPassRate:
      typeof s.slaMinPassRate === "number" && Number.isFinite(s.slaMinPassRate)
        ? Math.min(1, Math.max(0, s.slaMinPassRate))
        : undefined,
    familiarId: typeof s.familiarId === "string" ? s.familiarId : undefined,
    cases: Array.isArray(s.cases)
      ? s.cases.map(coerceCase).filter((c): c is EvalCase => c !== null)
      : [],
    createdAt: typeof s.createdAt === "string" ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : now,
  };
}

function coerceEvalGroup(value: unknown): EvalGroup | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  if (typeof g.id !== "string") return null;
  const now = new Date().toISOString();
  const members: EvalGroup["members"] = Array.isArray(g.members)
    ? g.members
        .map((member): EvalGroup["members"][number] | null => {
          if (!member || typeof member !== "object") return null;
          const m = member as Record<string, unknown>;
          const kind = typeof m.kind === "string" ? m.kind : "";
          if (!["thread", "familiar", "project", "filter"].includes(kind) || typeof m.id !== "string") return null;
          const coerced: EvalGroup["members"][number] = { kind: kind as EvalGroup["members"][number]["kind"], id: m.id };
          if (typeof m.familiarId === "string") coerced.familiarId = m.familiarId;
          if (typeof m.latestTurnId === "string") coerced.latestTurnId = m.latestTurnId;
          if (typeof m.inputHash === "string") coerced.inputHash = m.inputHash;
          if (typeof m.confidenceRubricVersion === "string") coerced.confidenceRubricVersion = m.confidenceRubricVersion;
          if (typeof m.skillsVersion === "string") coerced.skillsVersion = m.skillsVersion;
          if (typeof m.permissionsHash === "string") coerced.permissionsHash = m.permissionsHash;
          if (Array.isArray(m.responseConfidenceEventIds)) {
            coerced.responseConfidenceEventIds = m.responseConfidenceEventIds.filter((id): id is string => typeof id === "string");
          }
          return coerced;
        })
        .filter((member): member is EvalGroup["members"][number] => member !== null)
    : [];
  const tracks = Array.isArray(g.tracks)
    ? g.tracks.filter((track): track is EvalGroup["tracks"][number] =>
        typeof track === "string" && ["synthesis", "prompt", "memory", "confidence", "regression"].includes(track),
      )
    : [];
  return {
    id: g.id,
    name: typeof g.name === "string" && g.name.trim() ? g.name : g.id,
    description: typeof g.description === "string" ? g.description : undefined,
    scope: typeof g.scope === "string" && ["thread", "familiar", "project", "release", "custom"].includes(g.scope)
      ? g.scope as EvalGroup["scope"]
      : "custom",
    members,
    tracks,
    rubricVersion: typeof g.rubricVersion === "string" ? g.rubricVersion : "rubric-v1",
    stalePolicy: {
      ttlMs: typeof (g.stalePolicy as Record<string, unknown> | undefined)?.ttlMs === "number"
        ? (g.stalePolicy as { ttlMs: number }).ttlMs
        : undefined,
    },
    schedulePolicy: {
      mode: (g.schedulePolicy as Record<string, unknown> | undefined)?.mode === "automatic" ? "automatic" : "manual",
    },
    createdAt: typeof g.createdAt === "string" ? g.createdAt : now,
    updatedAt: typeof g.updatedAt === "string" ? g.updatedAt : now,
  };
}

function coerceThreadEvalSnapshot(value: unknown): ThreadEvalSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (typeof s.threadId !== "string" || typeof s.familiarId !== "string") return null;
  return {
    threadId: s.threadId,
    familiarId: s.familiarId,
    evalGroupId: typeof s.evalGroupId === "string" ? s.evalGroupId : undefined,
    evaluatedThroughTurnId: typeof s.evaluatedThroughTurnId === "string" ? s.evaluatedThroughTurnId : undefined,
    inputHash: typeof s.inputHash === "string" ? s.inputHash : undefined,
    rubricVersion: typeof s.rubricVersion === "string" ? s.rubricVersion : undefined,
    confidenceRubricVersion: typeof s.confidenceRubricVersion === "string" ? s.confidenceRubricVersion : undefined,
    skillsVersion: typeof s.skillsVersion === "string" ? s.skillsVersion : undefined,
    permissionsHash: typeof s.permissionsHash === "string" ? s.permissionsHash : undefined,
    responseConfidenceEventIds: Array.isArray(s.responseConfidenceEventIds)
      ? s.responseConfidenceEventIds.filter((id): id is string => typeof id === "string")
      : [],
    evaluatedAt: typeof s.evaluatedAt === "string" ? s.evaluatedAt : new Date().toISOString(),
  };
}

function coerceQueueItem(value: unknown): ManualEvalQueueItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.groupId !== "string" ||
    typeof item.threadId !== "string" ||
    typeof item.familiarId !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    groupId: item.groupId,
    threadId: item.threadId,
    familiarId: item.familiarId,
    tracks: Array.isArray(item.tracks)
      ? item.tracks.filter((track): track is ManualEvalQueueItem["tracks"][number] =>
          typeof track === "string" && ["synthesis", "prompt", "memory", "confidence", "regression"].includes(track),
        )
      : [],
    staleReasons: Array.isArray(item.staleReasons)
      ? item.staleReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    priority: "normal",
    status: "queued",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  };
}

async function listJsonDir<T>(dir: string, coerce: (value: unknown) => T | null): Promise<T[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const item = coerce(JSON.parse(await readFile(path.join(dir, entry), "utf8")));
      if (item) items.push(item);
    } catch {
      // Skip corrupt files so one bad record does not blank the whole view.
    }
  }
  return items;
}

// ---- Groups / thread state / manual queue ----------------------------------

export async function listEvalGroups(): Promise<EvalGroup[]> {
  const groups = await listJsonDir(groupsDir(), coerceEvalGroup);
  groups.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
  return groups;
}

export async function saveEvalGroup(input: unknown): Promise<EvalGroup> {
  const group = coerceEvalGroup(input);
  if (!group) throw new Error("invalid eval group");
  await mkdir(groupsDir(), { recursive: true });
  await writeJsonAtomic(path.join(groupsDir(), fileName(group.id, "group")), group);
  return group;
}

export async function deleteEvalGroup(id: string): Promise<boolean> {
  try {
    await rm(path.join(groupsDir(), fileName(id, "group")), { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function listThreadEvalSnapshots(): Promise<ThreadEvalSnapshot[]> {
  const snapshots = await listJsonDir(threadStatesDir(), coerceThreadEvalSnapshot);
  snapshots.sort((a, b) => (b.evaluatedAt > a.evaluatedAt ? 1 : b.evaluatedAt < a.evaluatedAt ? -1 : 0));
  return snapshots;
}

export async function saveThreadEvalSnapshot(input: unknown): Promise<ThreadEvalSnapshot> {
  const snapshot = coerceThreadEvalSnapshot(input);
  if (!snapshot) throw new Error("invalid thread eval snapshot");
  await mkdir(threadStatesDir(), { recursive: true });
  await writeJsonAtomic(path.join(threadStatesDir(), fileName(`${snapshot.familiarId}-${snapshot.threadId}`, "thread")), snapshot);
  return snapshot;
}

export async function listManualEvalQueue(): Promise<ManualEvalQueueItem[]> {
  const items = await listJsonDir(queueDir(), coerceQueueItem);
  items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
  return items;
}

export async function enqueueManualEvalGroupRun(
  group: EvalGroup,
  states: ThreadEvalState[],
  createdAt = new Date().toISOString(),
): Promise<ManualEvalQueueItem[]> {
  const sanitizedGroup = coerceEvalGroup(group);
  if (!sanitizedGroup) throw new Error("invalid eval group");
  const items = buildManualEvalQueueItems(sanitizedGroup, states, createdAt);
  await mkdir(queueDir(), { recursive: true });
  for (const item of items) {
    await writeJsonAtomic(path.join(queueDir(), fileName(item.id, "queue")), item);
  }
  return items;
}

// ---- Suites ----------------------------------------------------------------

export async function listSuites(): Promise<EvalSuite[]> {
  let entries: string[];
  try {
    entries = await readdir(suitesDir());
  } catch {
    return [];
  }
  const suites: EvalSuite[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const suite = coerceSuite(JSON.parse(await readFile(path.join(suitesDir(), entry), "utf8")));
      if (suite) suites.push(suite);
    } catch {
      // Skip a corrupt suite rather than failing the whole list.
    }
  }
  suites.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
  return suites;
}

export async function loadSuite(id: string): Promise<EvalSuite | null> {
  try {
    return coerceSuite(JSON.parse(await readFile(path.join(suitesDir(), fileName(id, "suite")), "utf8")));
  } catch {
    return null;
  }
}

export async function saveSuite(input: unknown): Promise<EvalSuite> {
  const suite = coerceSuite(input);
  if (!suite) throw new Error("invalid eval suite");
  const saved: EvalSuite = { ...suite, updatedAt: new Date().toISOString() };
  await mkdir(suitesDir(), { recursive: true });
  await writeJsonAtomic(path.join(suitesDir(), fileName(saved.id, "suite")), saved);
  return saved;
}

export async function deleteSuite(id: string): Promise<boolean> {
  try {
    await rm(path.join(suitesDir(), fileName(id, "suite")), { force: true });
    return true;
  } catch {
    return false;
  }
}

// ---- Runs ------------------------------------------------------------------

function coerceRun(value: unknown): EvalRun | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.suiteId !== "string") return null;
  const results = Array.isArray(r.results) ? (r.results as EvalRun["results"]) : [];
  return {
    id: r.id,
    suiteId: r.suiteId,
    suiteName: typeof r.suiteName === "string" ? r.suiteName : r.suiteId,
    familiarId: typeof r.familiarId === "string" ? r.familiarId : "",
    familiarName: typeof r.familiarName === "string" ? r.familiarName : undefined,
    startedAt: typeof r.startedAt === "string" ? r.startedAt : new Date().toISOString(),
    finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : undefined,
    results,
    // Always recompute the summary from results so it can't drift / be spoofed.
    summary: summarizeResults(results),
  };
}

export async function listRuns(suiteId?: string): Promise<EvalRun[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir());
  } catch {
    return [];
  }
  const runs: EvalRun[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const run = coerceRun(JSON.parse(await readFile(path.join(runsDir(), entry), "utf8")));
      if (run && (!suiteId || run.suiteId === suiteId)) runs.push(run);
    } catch {
      // skip corrupt
    }
  }
  runs.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  return runs;
}

export async function saveRun(input: unknown): Promise<EvalRun> {
  const run = coerceRun(input);
  if (!run) throw new Error("invalid eval run");
  await mkdir(runsDir(), { recursive: true });
  await writeJsonAtomic(path.join(runsDir(), fileName(run.id, "run")), run);
  await pruneRuns();
  return run;
}

export async function deleteRun(id: string): Promise<boolean> {
  try {
    await rm(path.join(runsDir(), fileName(id, "run")), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Keep the newest EVAL_RUNS_CAP run files *per suite*; drop the rest. Capping
 *  globally let one busy suite silently evict another suite's run history. */
async function pruneRuns(): Promise<void> {
  const bySuite = new Map<string, EvalRun[]>();
  for (const run of await listRuns()) {
    const list = bySuite.get(run.suiteId);
    if (list) list.push(run);
    else bySuite.set(run.suiteId, [run]);
  }
  for (const list of bySuite.values()) {
    // listRuns is newest-first, so slice(CAP) is the oldest beyond the per-suite cap.
    for (const run of list.slice(EVAL_RUNS_CAP)) {
      await rm(path.join(runsDir(), fileName(run.id, "run")), { force: true }).catch(() => {});
    }
  }
}
