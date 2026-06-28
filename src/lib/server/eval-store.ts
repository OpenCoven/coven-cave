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
  summarizeResults,
  type EvalSuite,
  type EvalCase,
  type EvalRun,
  type Grader,
  type GraderKind,
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
    familiarId: typeof s.familiarId === "string" ? s.familiarId : undefined,
    cases: Array.isArray(s.cases)
      ? s.cases.map(coerceCase).filter((c): c is EvalCase => c !== null)
      : [],
    createdAt: typeof s.createdAt === "string" ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : now,
  };
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

/** Keep the newest EVAL_RUNS_CAP run files; drop the rest. */
async function pruneRuns(): Promise<void> {
  const all = await listRuns();
  if (all.length <= EVAL_RUNS_CAP) return;
  for (const run of all.slice(EVAL_RUNS_CAP)) {
    await rm(path.join(runsDir(), fileName(run.id, "run")), { force: true }).catch(() => {});
  }
}
