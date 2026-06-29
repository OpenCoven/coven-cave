/**
 * Pure analysis derivations over eval runs. Everything here takes plain DTOs
 * (EvalRun/EvalCaseResult from eval-model) and returns display-ready data, so it
 * unit-tests without a network, DOM, or clock (see eval-analytics.test.ts).
 */

import type { EvalRun, GraderKind } from "@/lib/evals/eval-model";

/** A point for the trend chart: x = run start (ms epoch), y = pass rate 0..1. */
export type TrendPoint = { x: number; y: number };

/** Pass-rate over time for a set of runs (one suite's history), oldest-first.
 *  Runs with no cases are dropped (no meaningful rate). */
export function suitePassRateTrend(runs: EvalRun[]): TrendPoint[] {
  return runs
    .filter((r) => r.summary.total > 0)
    .map((r) => ({ x: Date.parse(r.startedAt), y: r.summary.passRate }))
    .filter((p) => Number.isFinite(p.x))
    .sort((a, b) => a.x - b.x);
}

export type RunDiffStatus = "regressed" | "fixed" | "fail" | "added" | "removed" | "pass";

export type RunDiffRow = {
  caseId: string;
  name: string;
  status: RunDiffStatus;
  before: boolean | null;
  after: boolean | null;
};

const DIFF_ORDER: Record<RunDiffStatus, number> = {
  regressed: 0,
  fixed: 1,
  fail: 2,
  added: 3,
  removed: 4,
  pass: 5,
};

/** Case-by-case diff between two runs, matched on caseId. Regressions
 *  (was passing, now failing) sort first; unchanged passes sink to the bottom. */
export function diffRuns(before: EvalRun, after: EvalRun): RunDiffRow[] {
  const beforeById = new Map(before.results.map((r) => [r.caseId, r]));
  const afterById = new Map(after.results.map((r) => [r.caseId, r]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];

  const rows: RunDiffRow[] = ids.map((id) => {
    const b = beforeById.get(id);
    const a = afterById.get(id);
    const name = a?.name ?? b?.name ?? id;
    if (b && !a) return { caseId: id, name, status: "removed", before: b.pass, after: null };
    if (!b && a) return { caseId: id, name, status: "added", before: null, after: a.pass };
    // both present
    const bp = b!.pass;
    const ap = a!.pass;
    let status: RunDiffStatus;
    if (bp && !ap) status = "regressed";
    else if (!bp && ap) status = "fixed";
    else status = ap ? "pass" : "fail";
    return { caseId: id, name, status, before: bp, after: ap };
  });

  return rows.sort((x, y) => DIFF_ORDER[x.status] - DIFF_ORDER[y.status] || x.name.localeCompare(y.name));
}

export type CaseFailureStat = {
  caseId: string;
  name: string;
  failures: number;
  runs: number;
  /** Alternated pass/fail >= 2 times across the run history. */
  flaky: boolean;
};

export type GraderFailureStat = { kind: GraderKind; failures: number };

/** Failure analysis across a run history: per-case failure counts + flakiness,
 *  and per-grader-kind failure counts. Runs are read oldest-first so flakiness
 *  (pass/fail transitions) is meaningful. Only cases that failed at least once
 *  or are flaky are returned, most-failures first. */
export function failureClusters(runs: EvalRun[]): {
  byCase: CaseFailureStat[];
  byGrader: GraderFailureStat[];
} {
  const sorted = [...runs].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const caseMap = new Map<string, { name: string; results: boolean[] }>();
  const graderFails = new Map<GraderKind, number>();

  for (const run of sorted) {
    for (const res of run.results) {
      const entry = caseMap.get(res.caseId) ?? { name: res.name, results: [] };
      entry.name = res.name;
      entry.results.push(res.pass);
      caseMap.set(res.caseId, entry);
      for (const grader of res.graders) {
        if (!grader.pass) graderFails.set(grader.kind, (graderFails.get(grader.kind) ?? 0) + 1);
      }
    }
  }

  const byCase: CaseFailureStat[] = [...caseMap.entries()]
    .map(([caseId, e]) => {
      const failures = e.results.filter((p) => !p).length;
      let transitions = 0;
      for (let i = 1; i < e.results.length; i++) {
        if (e.results[i] !== e.results[i - 1]) transitions++;
      }
      return { caseId, name: e.name, failures, runs: e.results.length, flaky: transitions >= 2 };
    })
    .filter((c) => c.failures > 0 || c.flaky)
    .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));

  const byGrader: GraderFailureStat[] = [...graderFails.entries()]
    .map(([kind, failures]) => ({ kind, failures }))
    .sort((a, b) => b.failures - a.failures);

  return { byCase, byGrader };
}
