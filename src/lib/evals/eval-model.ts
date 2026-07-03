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
  /** Optional pass-rate SLA floor (0..1). The Insights trend draws it as a
   *  threshold line and flags a breach when the latest run dips below it. */
  slaMinPassRate?: number;
  /** Default familiar to run against; the run UI may override. */
  familiarId?: string;
  cases: EvalCase[];
  createdAt: string;
  updatedAt: string;
};

export type EvalGroupScope = "thread" | "familiar" | "project" | "release" | "custom";
export type EvalTrack = "synthesis" | "prompt" | "memory" | "confidence" | "regression";
export type ThreadEvalStatus = "fresh" | "stale" | "running" | "blocked" | "never-run";

export type EvalGroupMember = {
  kind: "thread" | "familiar" | "project" | "filter";
  id: string;
  familiarId?: string;
  latestTurnId?: string;
  inputHash?: string;
  confidenceRubricVersion?: string;
  skillsVersion?: string;
  permissionsHash?: string;
  responseConfidenceEventIds?: string[];
};

export type EvalGroup = {
  id: string;
  name: string;
  description?: string;
  scope: EvalGroupScope;
  members: EvalGroupMember[];
  tracks: EvalTrack[];
  rubricVersion: string;
  stalePolicy: {
    ttlMs?: number;
  };
  schedulePolicy: {
    mode: "manual" | "automatic";
  };
  createdAt: string;
  updatedAt: string;
};

export type ThreadEvalSnapshot = {
  threadId: string;
  familiarId: string;
  evalGroupId?: string;
  evaluatedThroughTurnId?: string;
  inputHash?: string;
  rubricVersion?: string;
  confidenceRubricVersion?: string;
  skillsVersion?: string;
  permissionsHash?: string;
  responseConfidenceEventIds: string[];
  evaluatedAt: string;
};

export type ThreadEvalCurrent = {
  threadId: string;
  familiarId: string;
  latestTurnId?: string;
  inputHash?: string;
  rubricVersion?: string;
  confidenceRubricVersion?: string;
  skillsVersion?: string;
  permissionsHash?: string;
  responseConfidenceEventIds?: string[];
  ttlMs?: number;
  now?: string;
  groupUpdatedAt?: string;
  evalLock?: {
    locked?: boolean;
    stale?: boolean;
  };
};

export type ThreadEvalState = {
  threadId: string;
  familiarId: string;
  status: ThreadEvalStatus;
  staleReasons: string[];
  evaluatedAt: string | null;
  details: {
    latestTurnId?: string;
    evaluatedThroughTurnId?: string;
    rubricVersion?: string;
    snapshotRubricVersion?: string;
    confidenceRubricVersion?: string;
    snapshotConfidenceRubricVersion?: string;
    skillsVersion?: string;
    snapshotSkillsVersion?: string;
    permissionsHash?: string;
    snapshotPermissionsHash?: string;
    responseConfidenceEventCount: number;
    snapshotResponseConfidenceEventCount: number;
    groupUpdatedAt?: string;
    ttlMs?: number;
  };
};

export type EvalGroupRollup = {
  groupId: string;
  totalThreads: number;
  freshThreads: number;
  staleThreads: number;
  runningThreads: number;
  blockedThreads: number;
  neverRunThreads: number;
  runnableThreadIds: string[];
};

export type ManualEvalQueueItem = {
  id: string;
  groupId: string;
  threadId: string;
  familiarId: string;
  tracks: EvalTrack[];
  staleReasons: string[];
  priority: "normal";
  status: "queued";
  createdAt: string;
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
export function applyJudgeVerdict(g: Grader, verdictScore: number, detail: string, pass?: boolean): GraderResult {
  const score = clamp01(verdictScore);
  // Honor the judge's explicit boolean when it gave one; only fall back to the
  // score threshold when it didn't. A judge can legitimately return score 0.9
  // with pass:false (or vice-versa) and its own decision must win.
  const passed = pass ?? score >= 0.5;
  return {
    kind: "llm_judge",
    label: graderLabel(g),
    pass: passed,
    score,
    detail: detail || (passed ? "judge passed" : "judge failed"),
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

export function deriveThreadEvalState(snapshot: ThreadEvalSnapshot | null, current: ThreadEvalCurrent): ThreadEvalState {
  const details = buildThreadEvalDetails(snapshot, current);
  if (!snapshot) {
    return {
      threadId: current.threadId,
      familiarId: current.familiarId,
      status: "never-run",
      staleReasons: ["never-run"],
      evaluatedAt: null,
      details,
    };
  }

  if (current.evalLock?.locked && current.evalLock.stale) {
    return {
      threadId: current.threadId,
      familiarId: current.familiarId,
      status: "blocked",
      staleReasons: ["eval-lock-stale"],
      evaluatedAt: snapshot.evaluatedAt,
      details,
    };
  }

  if (current.evalLock?.locked) {
    return {
      threadId: current.threadId,
      familiarId: current.familiarId,
      status: "running",
      staleReasons: [],
      evaluatedAt: snapshot.evaluatedAt,
      details,
    };
  }

  const reasons: string[] = [];
  if (current.latestTurnId && snapshot.evaluatedThroughTurnId && current.latestTurnId !== snapshot.evaluatedThroughTurnId) {
    reasons.push("new-turns");
  }
  if (current.inputHash && snapshot.inputHash && current.inputHash !== snapshot.inputHash) {
    reasons.push("thread-changed");
  }
  if (current.rubricVersion && snapshot.rubricVersion && current.rubricVersion !== snapshot.rubricVersion) {
    reasons.push("rubric-changed");
  }
  if (
    current.confidenceRubricVersion &&
    snapshot.confidenceRubricVersion &&
    current.confidenceRubricVersion !== snapshot.confidenceRubricVersion
  ) {
    reasons.push("confidence-rubric-changed");
  }
  if (current.skillsVersion && snapshot.skillsVersion && current.skillsVersion !== snapshot.skillsVersion) {
    reasons.push("skills-changed");
  }
  if (current.permissionsHash && snapshot.permissionsHash && current.permissionsHash !== snapshot.permissionsHash) {
    reasons.push("permissions-changed");
  }
  if (hasNewConfidenceEvents(snapshot.responseConfidenceEventIds, current.responseConfidenceEventIds ?? [])) {
    reasons.push("confidence-events-added");
  }
  if (current.groupUpdatedAt && Date.parse(current.groupUpdatedAt) > Date.parse(snapshot.evaluatedAt)) {
    reasons.push("group-changed");
  }
  if (current.ttlMs && Date.parse(current.now ?? new Date().toISOString()) - Date.parse(snapshot.evaluatedAt) > current.ttlMs) {
    reasons.push("ttl-expired");
  }

  return {
    threadId: current.threadId,
    familiarId: current.familiarId,
    status: reasons.length ? "stale" : "fresh",
    staleReasons: reasons,
    evaluatedAt: snapshot.evaluatedAt,
    details,
  };
}

function buildThreadEvalDetails(snapshot: ThreadEvalSnapshot | null, current: ThreadEvalCurrent): ThreadEvalState["details"] {
  return {
    latestTurnId: current.latestTurnId,
    evaluatedThroughTurnId: snapshot?.evaluatedThroughTurnId,
    rubricVersion: current.rubricVersion,
    snapshotRubricVersion: snapshot?.rubricVersion,
    confidenceRubricVersion: current.confidenceRubricVersion,
    snapshotConfidenceRubricVersion: snapshot?.confidenceRubricVersion,
    skillsVersion: current.skillsVersion,
    snapshotSkillsVersion: snapshot?.skillsVersion,
    permissionsHash: current.permissionsHash,
    snapshotPermissionsHash: snapshot?.permissionsHash,
    responseConfidenceEventCount: current.responseConfidenceEventIds?.length ?? 0,
    snapshotResponseConfidenceEventCount: snapshot?.responseConfidenceEventIds.length ?? 0,
    groupUpdatedAt: current.groupUpdatedAt,
    ttlMs: current.ttlMs,
  };
}

export function rollupEvalGroup(group: EvalGroup, states: readonly ThreadEvalState[]): EvalGroupRollup {
  const groupThreadIds = new Set(
    group.members
      .filter((member) => member.kind === "thread")
      .map((member) => member.id),
  );
  const scoped = states.filter((state) => groupThreadIds.size === 0 || groupThreadIds.has(state.threadId));
  return {
    groupId: group.id,
    totalThreads: scoped.length,
    freshThreads: scoped.filter((state) => state.status === "fresh").length,
    staleThreads: scoped.filter((state) => state.status === "stale").length,
    runningThreads: scoped.filter((state) => state.status === "running").length,
    blockedThreads: scoped.filter((state) => state.status === "blocked").length,
    neverRunThreads: scoped.filter((state) => state.status === "never-run").length,
    runnableThreadIds: scoped
      .filter((state) => state.status === "stale" || state.status === "never-run")
      .map((state) => state.threadId),
  };
}

export function buildManualEvalQueueItems(
  group: EvalGroup,
  states: readonly ThreadEvalState[],
  createdAt = new Date().toISOString(),
): ManualEvalQueueItem[] {
  return states
    .filter((state) => state.status === "stale" || state.status === "never-run")
    .map((state) => ({
      id: stableQueueId(group.id, state.threadId, createdAt),
      groupId: group.id,
      threadId: state.threadId,
      familiarId: state.familiarId,
      tracks: group.tracks,
      staleReasons: state.staleReasons,
      priority: "normal" as const,
      status: "queued" as const,
      createdAt,
    }));
}

function hasNewConfidenceEvents(previous: string[], current: string[]): boolean {
  if (current.length <= previous.length) return false;
  const seen = new Set(previous);
  return current.some((id) => !seen.has(id));
}

function stableQueueId(groupId: string, threadId: string, createdAt: string): string {
  return `queue-${slug(groupId)}-${slug(threadId)}-${slug(createdAt)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
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
