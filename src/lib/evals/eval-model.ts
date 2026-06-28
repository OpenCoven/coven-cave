// Pure domain model for Familiar Evals — defining eval suites, deterministic
// grading, and run aggregation. Kept free of React/DOM/Node so it can be unit
// tested in isolation and reused by both the API route and the surface.
//
// A *suite* is a named set of *cases*. Each case sends an `input` prompt to a
// familiar and grades the produced `output` against one or more *graders*. A
// *run* records the per-case outcome for one execution of a suite against one
// familiar, plus a rolled-up summary.

export type GraderKind =
  | "contains"
  | "not_contains"
  | "regex"
  | "equals"
  | "json_has"
  | "latency_under"
  | "llm_judge";

/** A single pass/fail check applied to a case's output. */
export type Grader = {
  kind: GraderKind;
  /** Target value: substring, pattern source, expected text, json path, or ms. */
  value: string;
  /** contains/equals: compare case-insensitively. Default false. */
  caseInsensitive?: boolean;
  /** llm_judge: the rubric the judge familiar grades against. */
  rubric?: string;
  /** Optional human label shown in the results table. */
  label?: string;
};

export type EvalCase = {
  id: string;
  /** Short name for the row. */
  name: string;
  /** The prompt sent to the familiar under test. */
  input: string;
  /** One or more graders; a case passes only if ALL graders pass. */
  graders: Grader[];
};

export type EvalSuite = {
  id: string;
  name: string;
  description?: string;
  /** Default familiar to run against; the run UI may override. */
  familiarId?: string;
  cases: EvalCase[];
  createdAt: string;
  updatedAt: string;
};

export type GraderResult = {
  kind: GraderKind;
  label: string;
  pass: boolean;
  /** 0..1 — deterministic graders emit 1/0; llm_judge may emit partial. */
  score: number;
  /** Why it passed/failed, surfaced in the UI. */
  detail: string;
};

export type EvalCaseResult = {
  caseId: string;
  name: string;
  input: string;
  output: string;
  /** Wall-clock latency of producing `output`, in ms. */
  latencyMs: number;
  graders: GraderResult[];
  /** AND over grader passes. */
  pass: boolean;
  /** Mean of grader scores. */
  score: number;
  /** Populated when the familiar call itself errored. */
  error?: string;
};

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  /** passed / total, 0..1 (0 when empty). */
  passRate: number;
  /** Mean case score, 0..1. */
  avgScore: number;
  /** Mean case latency in ms. */
  avgLatencyMs: number;
};

export type EvalRun = {
  id: string;
  suiteId: string;
  suiteName: string;
  familiarId: string;
  familiarName?: string;
  startedAt: string;
  finishedAt?: string;
  results: EvalCaseResult[];
  summary: EvalRunSummary;
};

const EMPTY_SUMMARY: EvalRunSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  passRate: 0,
  avgScore: 0,
  avgLatencyMs: 0,
};

const GRADER_LABELS: Record<GraderKind, string> = {
  contains: "Contains",
  not_contains: "Excludes",
  regex: "Matches",
  equals: "Equals",
  json_has: "JSON has",
  latency_under: "Latency",
  llm_judge: "Judge",
};

export function graderLabel(g: Grader): string {
  return g.label?.trim() || GRADER_LABELS[g.kind];
}

/**
 * Grade a single deterministic grader against an output (+ latency for the
 * timing grader). `llm_judge` is NOT graded here — it requires a model call, so
 * callers pass the judge verdict in via {@link applyJudgeVerdict}. We return a
 * neutral "pending" result so a suite that mixes judge + deterministic graders
 * still renders.
 */
export function gradeDeterministic(g: Grader, output: string, latencyMs: number): GraderResult {
  const label = graderLabel(g);
  const out = g.caseInsensitive ? output.toLowerCase() : output;
  const val = g.caseInsensitive ? g.value.toLowerCase() : g.value;
  const ok = (pass: boolean, detail: string): GraderResult => ({
    kind: g.kind,
    label,
    pass,
    score: pass ? 1 : 0,
    detail,
  });

  switch (g.kind) {
    case "contains":
      return ok(out.includes(val), out.includes(val) ? `found “${g.value}”` : `missing “${g.value}”`);
    case "not_contains":
      return ok(!out.includes(val), out.includes(val) ? `unexpected “${g.value}”` : `absent “${g.value}”`);
    case "equals":
      return ok(out.trim() === val.trim(), out.trim() === val.trim() ? "exact match" : "differs from expected");
    case "regex": {
      let re: RegExp | null = null;
      try {
        re = new RegExp(g.value, g.caseInsensitive ? "i" : "");
      } catch {
        return ok(false, `invalid pattern: ${g.value}`);
      }
      const m = re.test(output);
      return ok(m, m ? `matched /${g.value}/` : `no match for /${g.value}/`);
    }
    case "json_has": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(output));
      } catch {
        return ok(false, "output is not valid JSON");
      }
      const found = jsonHasPath(parsed, g.value);
      return ok(found, found ? `has path ${g.value}` : `missing path ${g.value}`);
    }
    case "latency_under": {
      const limit = Number(g.value);
      if (!Number.isFinite(limit)) return ok(false, `invalid ms: ${g.value}`);
      const pass = latencyMs <= limit;
      return ok(pass, `${Math.round(latencyMs)}ms ${pass ? "≤" : ">"} ${limit}ms`);
    }
    case "llm_judge":
      return {
        kind: "llm_judge",
        label,
        pass: false,
        score: 0,
        detail: "awaiting judge",
      };
    default:
      return ok(false, "unknown grader");
  }
}

/** True when a grader needs a model call rather than deterministic evaluation. */
export function graderNeedsModel(g: Grader): boolean {
  return g.kind === "llm_judge";
}

/**
 * Fold a judge verdict (produced by the client via the chat pipeline) into a
 * judge grader result. `verdictScore` is 0..1; pass threshold is 0.5.
 */
export function applyJudgeVerdict(g: Grader, verdictScore: number, detail: string): GraderResult {
  const score = clamp01(verdictScore);
  return {
    kind: "llm_judge",
    label: graderLabel(g),
    pass: score >= 0.5,
    score,
    detail: detail || (score >= 0.5 ? "judge passed" : "judge failed"),
  };
}

/** Build a case result from graded graders. AND for pass, mean for score. */
export function buildCaseResult(
  c: EvalCase,
  output: string,
  latencyMs: number,
  graders: GraderResult[],
  error?: string,
): EvalCaseResult {
  const pass = graders.length > 0 && graders.every((g) => g.pass) && !error;
  const score = graders.length ? mean(graders.map((g) => g.score)) : 0;
  return {
    caseId: c.id,
    name: c.name,
    input: c.input,
    output,
    latencyMs,
    graders,
    pass,
    score: error ? 0 : score,
    error,
  };
}

export function summarizeResults(results: EvalCaseResult[]): EvalRunSummary {
  if (results.length === 0) return { ...EMPTY_SUMMARY };
  const passed = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: passed / results.length,
    avgScore: mean(results.map((r) => r.score)),
    avgLatencyMs: mean(results.map((r) => r.latencyMs)),
  };
}

export function emptySummary(): EvalRunSummary {
  return { ...EMPTY_SUMMARY };
}

/** Reasons a suite cannot be run, for surfacing a disabled Run button. */
export function suiteRunBlockReason(suite: EvalSuite, familiarId: string | undefined): string | null {
  if (!familiarId) return "Pick a familiar to evaluate";
  if (suite.cases.length === 0) return "Add at least one case";
  const blank = suite.cases.find((c) => c.input.trim().length === 0);
  if (blank) return `Case “${blank.name || "untitled"}” has no input`;
  const noGraders = suite.cases.find((c) => c.graders.length === 0);
  if (noGraders) return `Case “${noGraders.name || "untitled"}” has no graders`;
  return null;
}

// ---- internals -------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Pull the first {...} or [...] JSON blob out of a possibly-chatty output. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const obj = trimmed.match(/[{[][\s\S]*[}\]]/);
  return obj ? obj[0] : trimmed;
}

/** Dot/bracket path existence check, e.g. "result.items.0.id". */
function jsonHasPath(root: unknown, path: string): boolean {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur !== undefined;
}
