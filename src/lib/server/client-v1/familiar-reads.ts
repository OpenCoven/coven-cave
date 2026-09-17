/**
 * Canonical read projections for one familiar's contract and analytics.
 *
 * Both are promotions of reads the Cave's own Studio already makes —
 * `/api/familiars/:id/contract` and `/api/familiars/:id/execution-analytics` —
 * into `/api/client/v1`, so a paired client and the desktop never disagree
 * about what a familiar may do or how it has been running. The rules from
 * reads.ts apply unchanged: a field survives only if it describes the resource
 * to a *client*, optional fields are omitted rather than set to `undefined`,
 * and a rename upstream is a type error here and nowhere else.
 *
 * Two things the private routes serve are deliberately withheld:
 *
 *   - the familiar's `workspace` path. It is the operator's filesystem, and a
 *     `chat:read` grant is a grant to read the familiar, not the disk it lives
 *     on. `present` says which contract files exist without saying where.
 *   - nothing else — the report, identity fields, ward, windows, and attempts
 *     are the same records the desktop renders. The ward in particular is the
 *     point of the promotion: what a familiar may do alone, what it must ask
 *     about, and the only paths it may change were a local fiction in Chat
 *     until Cave served them.
 */

import {
  evaluateFamiliarContract,
  parseIdentity,
  parseWardToml,
  type ContractFiles,
  type ContractReport,
} from "../../familiar-contract.ts";
import {
  EXECUTION_ANALYTICS_WINDOWS,
  type ExecutionAnalyticsWindowKey,
  type FamiliarExecutionAnalytics,
  type FamiliarExecutionAnalyticsWindow,
  type FamiliarExecutionAttemptSummary,
  type FamiliarExecutionBackfillState,
  type FamiliarExecutionCoverage,
  type FamiliarExecutionDay,
  type FamiliarExecutionSlice,
} from "../../familiar-execution-analytics.ts";

// ── Contract ──────────────────────────────────────────────────────────────────

export type ClientV1FamiliarContractPresence = {
  soul: boolean;
  identity: boolean;
  ward: boolean;
  memory: boolean;
};

/** IDENTITY.md-derived fields. Present only when the file is. */
export type ClientV1FamiliarIdentityRecord = {
  name?: string;
  creature?: string;
  person?: string;
};

/**
 * The ward, parsed from `ward.toml`. Present only when the file is.
 *
 * `approvalTiers.auto` is what the familiar may do without asking and
 * `approvalTiers.humanReview` what a person must approve. Both are served as
 * the list of actions the ward names — the `blocks` of a tier table, or the
 * inline `auto = [...]` / `human_review = [...]` form — so a client can match a
 * draft against them without knowing which spelling the ward's author used.
 */
export type ClientV1FamiliarWardRecord = {
  version?: string;
  familiar?: string;
  person?: string;
  protectedFiles: string[];
  invariants: string[];
  editablePaths: string[];
  approvalTiers: {
    auto: string[];
    humanReview: string[];
  };
};

export type ClientV1FamiliarContractRecord = {
  id: string;
  present: ClientV1FamiliarContractPresence;
  identity?: ClientV1FamiliarIdentityRecord;
  ward?: ClientV1FamiliarWardRecord;
  /** The Familiar Contract v0.1.0 adherence report, unchanged from the Studio's. */
  report: ContractReport;
};

function optionalText(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function textList(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function projectClientV1FamiliarContract(
  id: string,
  files: ContractFiles,
): ClientV1FamiliarContractRecord {
  const report = evaluateFamiliarContract(files);
  const present: ClientV1FamiliarContractPresence = {
    soul: files.soul !== null,
    identity: files.identity !== null,
    ward: files.ward !== null,
    memory: files.memory !== null,
  };

  let identity: ClientV1FamiliarIdentityRecord | undefined;
  if (files.identity !== null) {
    const parsed = parseIdentity(files.identity);
    const name = optionalText(parsed.name);
    const creature = optionalText(parsed.creature);
    const person = optionalText(parsed.person);
    identity = {
      ...(name ? { name } : {}),
      ...(creature ? { creature } : {}),
      ...(person ? { person } : {}),
    };
  }

  let ward: ClientV1FamiliarWardRecord | undefined;
  if (files.ward !== null) {
    const parsed = parseWardToml(files.ward);
    const version = optionalText(parsed.metaVersion);
    const familiar = optionalText(parsed.metaFamiliar);
    const person = optionalText(parsed.metaPerson);
    ward = {
      ...(version ? { version } : {}),
      ...(familiar ? { familiar } : {}),
      ...(person ? { person } : {}),
      protectedFiles: textList(parsed.protectedFiles),
      invariants: textList(parsed.protectedInvariants),
      editablePaths: textList(parsed.editablePaths),
      approvalTiers: {
        auto: textList(parsed.autoTier),
        humanReview: textList(parsed.humanReviewTier),
      },
    };
  }

  return {
    id,
    present,
    ...(identity ? { identity } : {}),
    ...(ward ? { ward } : {}),
    report,
  };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export type ClientV1ExecutionSlice = {
  key: string;
  label?: string;
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianDurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
};

export type ClientV1ExecutionCoverage = {
  known: number;
  total: number;
  ratio: number;
};

export type ClientV1ExecutionDay = {
  date: string;
  completed: number;
  failed: number;
  cancelled: number;
};

export type ClientV1ExecutionWindow = {
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Null when there were no settled attempts: a rate over nothing is not zero. */
  successRate: number | null;
  medianDurationMs?: number;
  p95DurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  models: ClientV1ExecutionSlice[];
  harnesses: ClientV1ExecutionSlice[];
  coverage: Record<string, ClientV1ExecutionCoverage>;
  /** Runs per UTC day, oldest first; only the day-shaped windows carry it. */
  days?: ClientV1ExecutionDay[];
};

export type ClientV1ExecutionAttempt = {
  id: string;
  sessionId?: string;
  turnId?: string;
  executionKind: string;
  occurredAt: string;
  harnessId: string;
  harnessVersion?: string;
  requestedModel?: string;
  forwardedModel?: string;
  confirmedModel?: string;
  status: "completed" | "failed" | "cancelled";
  durationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  provenance: "live" | "backfilled";
};

export type ClientV1ExecutionBackfill = {
  state: "complete" | "partial" | "not-started";
  imported: number;
  remaining?: number;
};

export type ClientV1FamiliarAnalyticsRecord = {
  generatedAt: string;
  /** Every window Cave aggregates, or only the one the request named. */
  windows: Partial<Record<ExecutionAnalyticsWindowKey, ClientV1ExecutionWindow>>;
  recentAttempts: ClientV1ExecutionAttempt[];
  backfill: ClientV1ExecutionBackfill;
};

function optionalNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectSlice(slice: FamiliarExecutionSlice): ClientV1ExecutionSlice {
  const label = optionalText(slice.label);
  const medianDurationMs = optionalNumber(slice.medianDurationMs);
  const totalTokens = optionalNumber(slice.totalTokens);
  const costUsd = optionalNumber(slice.costUsd);
  return {
    key: slice.key,
    ...(label ? { label } : {}),
    attempts: slice.attempts,
    completed: slice.completed,
    failed: slice.failed,
    cancelled: slice.cancelled,
    successRate: slice.successRate,
    ...(medianDurationMs === undefined ? {} : { medianDurationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: slice.toolCalls,
    toolFailures: slice.toolFailures,
  };
}

function projectCoverage(
  coverage: Record<string, FamiliarExecutionCoverage>,
): Record<string, ClientV1ExecutionCoverage> {
  return Object.fromEntries(
    Object.entries(coverage).map(([field, value]) => [
      field,
      { known: value.known, total: value.total, ratio: value.ratio },
    ]),
  );
}

function projectDay(day: FamiliarExecutionDay): ClientV1ExecutionDay {
  return {
    date: day.date,
    completed: day.completed,
    failed: day.failed,
    cancelled: day.cancelled,
  };
}

function projectWindow(window: FamiliarExecutionAnalyticsWindow): ClientV1ExecutionWindow {
  const medianDurationMs = optionalNumber(window.medianDurationMs);
  const p95DurationMs = optionalNumber(window.p95DurationMs);
  const totalTokens = optionalNumber(window.totalTokens);
  const costUsd = optionalNumber(window.costUsd);
  return {
    attempts: window.attempts,
    completed: window.completed,
    failed: window.failed,
    cancelled: window.cancelled,
    successRate: window.successRate,
    ...(medianDurationMs === undefined ? {} : { medianDurationMs }),
    ...(p95DurationMs === undefined ? {} : { p95DurationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: window.toolCalls,
    toolFailures: window.toolFailures,
    models: window.models.map(projectSlice),
    harnesses: window.harnesses.map(projectSlice),
    coverage: projectCoverage(window.coverage),
    ...(window.days ? { days: window.days.map(projectDay) } : {}),
  };
}

function projectAttempt(attempt: FamiliarExecutionAttemptSummary): ClientV1ExecutionAttempt {
  const sessionId = optionalText(attempt.sessionId);
  const turnId = optionalText(attempt.turnId);
  const harnessVersion = optionalText(attempt.harnessVersion);
  const requestedModel = optionalText(attempt.requestedModel);
  const forwardedModel = optionalText(attempt.forwardedModel);
  const confirmedModel = optionalText(attempt.confirmedModel);
  const durationMs = optionalNumber(attempt.durationMs);
  const totalTokens = optionalNumber(attempt.totalTokens);
  const costUsd = optionalNumber(attempt.costUsd);
  return {
    id: attempt.id,
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    executionKind: attempt.executionKind,
    occurredAt: attempt.occurredAt,
    harnessId: attempt.harnessId,
    ...(harnessVersion ? { harnessVersion } : {}),
    ...(requestedModel ? { requestedModel } : {}),
    ...(forwardedModel ? { forwardedModel } : {}),
    ...(confirmedModel ? { confirmedModel } : {}),
    status: attempt.status,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: attempt.toolCalls,
    toolFailures: attempt.toolFailures,
    provenance: attempt.provenance,
  };
}

function projectBackfill(backfill: FamiliarExecutionBackfillState): ClientV1ExecutionBackfill {
  const remaining = optionalNumber(backfill.remaining);
  return {
    state: backfill.state,
    imported: backfill.imported,
    ...(remaining === undefined ? {} : { remaining }),
  };
}

export function projectClientV1FamiliarAnalytics(
  analytics: FamiliarExecutionAnalytics,
  window: ExecutionAnalyticsWindowKey | null,
): ClientV1FamiliarAnalyticsRecord {
  const keys = window === null ? EXECUTION_ANALYTICS_WINDOWS : [window];
  const windows: ClientV1FamiliarAnalyticsRecord["windows"] = {};
  for (const key of keys) {
    const value = analytics.windows[key];
    if (value) windows[key] = projectWindow(value);
  }
  return {
    generatedAt: analytics.generatedAt,
    windows,
    recentAttempts: analytics.recentAttempts.map(projectAttempt),
    backfill: projectBackfill(analytics.backfill),
  };
}

// ── Analytics query ───────────────────────────────────────────────────────────

export const CLIENT_V1_ANALYTICS_DEFAULT_RECENT = 50;
export const CLIENT_V1_ANALYTICS_MAX_RECENT = 100;

const SUPPORTED_ANALYTICS_PARAMETERS = new Set(["window", "recent"]);
const RECENT_SHAPE = /^(0|[1-9][0-9]{0,2})$/;

export type ClientV1FamiliarAnalyticsQuery = {
  /** One window to serve, or null for all of them. */
  window: ExecutionAnalyticsWindowKey | null;
  recentLimit: number;
};

/**
 * The analytics read's query, refused rather than corrected.
 *
 * Same discipline as parseClientV1ReadPage: an unknown or repeated parameter
 * is an error, not noise, because a client that is answered normally for
 * `?limit=5` here learns that the parameter is accepted everywhere. `recent`
 * is bounded the way the Studio bounds it (0–100, default 50) but a value
 * outside the bound is refused instead of clamped, so the client's belief
 * about how many rows it holds is never wrong.
 */
export function parseClientV1FamiliarAnalyticsQuery(url: URL): ClientV1FamiliarAnalyticsQuery {
  const seen = new Set<string>();
  for (const name of url.searchParams.keys()) {
    if (!SUPPORTED_ANALYTICS_PARAMETERS.has(name)) {
      throw new Error(`Client v1 read requests do not support the "${name}" parameter.`);
    }
    if (seen.has(name)) {
      throw new Error(`Client v1 read requests accept "${name}" at most once.`);
    }
    seen.add(name);
  }

  const rawWindow = url.searchParams.get("window");
  let window: ExecutionAnalyticsWindowKey | null = null;
  if (rawWindow !== null) {
    if (!(EXECUTION_ANALYTICS_WINDOWS as readonly string[]).includes(rawWindow)) {
      throw new Error(
        `The "window" parameter must be one of ${EXECUTION_ANALYTICS_WINDOWS.join(", ")}.`,
      );
    }
    window = rawWindow as ExecutionAnalyticsWindowKey;
  }

  const rawRecent = url.searchParams.get("recent");
  let recentLimit = CLIENT_V1_ANALYTICS_DEFAULT_RECENT;
  if (rawRecent !== null) {
    if (!RECENT_SHAPE.test(rawRecent) || Number(rawRecent) > CLIENT_V1_ANALYTICS_MAX_RECENT) {
      throw new Error(
        `The "recent" parameter must be an integer between 0 and ${CLIENT_V1_ANALYTICS_MAX_RECENT}.`,
      );
    }
    recentLimit = Number(rawRecent);
  }

  return { window, recentLimit };
}
