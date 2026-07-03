// Client-side run engine for Familiar Evals.
//
// Executes a suite against a familiar entirely from the browser: each case's
// input goes through the existing chat bridge (/api/chat/send, SSE), the output
// is graded by the deterministic graders, and any llm_judge graders make a
// second chat call to score against their rubric. The assembled EvalRun is
// returned (and persisted by the caller via POST /api/evals/runs). This mirrors
// workflow-generate.ts — no new server-side LLM route.

import {
  gradeDeterministic,
  graderNeedsModel,
  applyJudgeVerdict,
  buildCaseResult,
  summarizeResults,
  type EvalSuite,
  type EvalCase,
  type EvalRun,
  type EvalCaseResult,
  type GraderResult,
} from "./eval-model.ts";
import { buildJudgePrompt, parseJudgeVerdict, judgeRubric } from "./eval-judge.ts";
import { streamFamiliarText } from "../familiar-stream.ts";

export type RunProgress = {
  /** Index of the case currently running (0-based). */
  index: number;
  total: number;
  /** Completed results so far, in order. */
  results: EvalCaseResult[];
  phase: "running" | "grading" | "done";
};

export type RunSuiteOptions = {
  suite: EvalSuite;
  familiarId: string;
  familiarName?: string;
  /** Familiar that grades llm_judge graders; defaults to the one under test. */
  judgeFamiliarId?: string;
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
};

function uid(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}`;
  }
}

/** Run every case in the suite and return the assembled (unsaved) run. */
export async function runSuite(opts: RunSuiteOptions): Promise<EvalRun> {
  const { suite, familiarId } = opts;
  const judgeId = opts.judgeFamiliarId ?? familiarId;
  const startedAt = new Date().toISOString();
  const results: EvalCaseResult[] = [];

  for (let i = 0; i < suite.cases.length; i++) {
    if (opts.signal?.aborted) break;
    const c = suite.cases[i];
    opts.onProgress?.({ index: i, total: suite.cases.length, results: [...results], phase: "running" });

    const started = Date.now();
    const { text, error } = await streamFamiliarText({ familiarId, prompt: c.input, signal: opts.signal });
    const latencyMs = Date.now() - started;

    if (error) {
      results.push(buildCaseResult(c, text, latencyMs, [], error));
      continue;
    }

    opts.onProgress?.({ index: i, total: suite.cases.length, results: [...results], phase: "grading" });
    const graders = await gradeCase(c, text, latencyMs, judgeId, opts.signal);
    results.push(buildCaseResult(c, text, latencyMs, graders));
  }

  opts.onProgress?.({ index: suite.cases.length, total: suite.cases.length, results: [...results], phase: "done" });

  return {
    id: uid("run"),
    suiteId: suite.id,
    suiteName: suite.name,
    familiarId,
    familiarName: opts.familiarName,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    summary: summarizeResults(results),
  };
}

/** Grade one case: deterministic graders inline, judge graders via a chat call. */
async function gradeCase(
  c: EvalCase,
  output: string,
  latencyMs: number,
  judgeFamiliarId: string,
  signal?: AbortSignal,
): Promise<GraderResult[]> {
  const out: GraderResult[] = [];
  for (const g of c.graders) {
    if (!graderNeedsModel(g)) {
      out.push(gradeDeterministic(g, output, latencyMs));
      continue;
    }
    const rubric = judgeRubric(g);
    if (!rubric) {
      out.push({ kind: "llm_judge", label: g.label ?? "Judge", pass: false, score: 0, detail: "no rubric set" });
      continue;
    }
    const { text, error } = await streamFamiliarText({
      familiarId: judgeFamiliarId,
      prompt: buildJudgePrompt(rubric, c.input, output),
      signal,
    });
    if (error) {
      out.push({ kind: "llm_judge", label: g.label ?? "Judge", pass: false, score: 0, detail: `judge error: ${error}` });
      continue;
    }
    const verdict = parseJudgeVerdict(text);
    out.push(applyJudgeVerdict(g, verdict.score, verdict.reason, verdict.pass));
  }
  return out;
}
