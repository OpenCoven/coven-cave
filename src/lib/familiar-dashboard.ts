/**
 * The shared, versioned Familiar dashboard READ contract (cave-9rwd.1).
 *
 * This module is pure and transport-agnostic on purpose. It holds the DTO, the
 * published limits, the closed issue-code registry, the deterministic section
 * state rule, and the byte budget — and it imports nothing that touches the
 * filesystem, the daemon, or `next/server`. The HTTP route and the aggregate
 * loader sit on top of it; a different transport (a paired Client v1 read, a
 * desktop IPC call) could sit on top of the same projection without changing a
 * line here.
 *
 * ## The property this contract exists to enforce
 *
 * A dashboard assembled from many independent sources must never let a source
 * FAILURE render as an honest ABSENCE. "No sessions" and "we could not read
 * sessions" produce completely different operator behaviour, and a client that
 * cannot tell them apart will confidently show a calm, empty, wrong screen.
 *
 * So the four server-emitted section states are pinned to three biconditionals,
 * asserted as properties in `familiar-dashboard.test.ts` over every reachable
 * combination rather than spot-checked on a fixture:
 *
 *   1. `data === null`            ⟺  state === "unavailable"
 *   2. `issues.length > 0`        ⟺  state is "partial" or "unavailable"
 *   3. state === "empty"          ⟹  issues.length === 0  (and data !== null)
 *
 * (3) is the load-bearing one: a section that failed to load can never be
 * `empty`. `empty` is a POSITIVE claim — "every source answered, and the answer
 * was nothing". Nothing else in this file may produce it.
 *
 * ## Why `stale` is defined but never emitted
 *
 * A client caches the last good section and re-renders it while a refresh is in
 * flight or after a refresh fails. That is a CLIENT-side fact — the server has
 * no cache and no notion of what the client is still holding — so `stale` lives
 * in the client state union and no builder or route here may return it. The
 * split is asserted, so a server builder cannot start emitting it by accident.
 */

import { deriveSignalTrends, type ThreadMetricSnapshot } from "@/lib/signal-trends";
import { threadConfidenceLabel, type ThreadConfidenceLabel } from "@/lib/thread-confidence";
import { aggregateThreadSignals, type ThreadSelfReport } from "@/lib/thread-self-report";

/** Bumped only for a breaking change to the shapes below. */
export const FAMILIAR_DASHBOARD_VERSION = 1 as const;

/**
 * Every bound this contract publishes, in one place, because "bounded" is
 * worthless as an adjective — it needs a number a client can plan against and a
 * behaviour at the limit.
 *
 * The list caps are NOT truncation in the dishonest sense: every bounded list
 * ships beside a `total`, so a client always knows how much it is not seeing.
 * `textCharacters` clamps every free-text field the DTO carries, which is what
 * makes the serialized size a function of the CAPS rather than of whatever
 * length a session title or memory excerpt happens to have — without it a
 * single pathological title could blow the whole response budget and the
 * shedding path below would be load-bearing in ordinary operation instead of
 * being the last resort it is meant to be.
 */
export const FAMILIAR_DASHBOARD_LIMITS = {
  /** Hard ceiling on the serialized success payload. Enforced, not hoped for. */
  responseBytes: 128 * 1024,
  activeSessions: 3,
  recentSessions: 5,
  assignedTasks: 6,
  taskDependencies: 8,
  attention: 6,
  reminders: 5,
  memoryEntries: 8,
  reports: 30,
  metricSnapshots: 100,
  activityDays: 14,
  analyticsItems: 5,
  contractFindings: 10,
  /** Per-field clamp for every free-text string the DTO carries. */
  textCharacters: 240,
} as const;

/** States the SERVER may emit. */
export const SERVER_DASHBOARD_SECTION_STATES = [
  "fresh",
  "partial",
  "empty",
  "unavailable",
] as const;
export type ServerDashboardSectionState =
  (typeof SERVER_DASHBOARD_SECTION_STATES)[number];

/**
 * States a CLIENT may hold. `stale` is client-only — see the module note.
 */
export const CLIENT_DASHBOARD_SECTION_STATES = [
  ...SERVER_DASHBOARD_SECTION_STATES,
  "stale",
] as const;
export type ClientDashboardSectionState =
  (typeof CLIENT_DASHBOARD_SECTION_STATES)[number];

/**
 * The sources this build actually reads.
 *
 * A reviewed literal listing only WIRED sources. Declaring a source the loader
 * never consults would advertise a capability that cannot fail and cannot
 * succeed, which is exactly the kind of decorative enum that makes a contract
 * read richer than the server is.
 */
export const FAMILIAR_DASHBOARD_SOURCES = [
  "familiar",
  "sessions",
  "tasks",
  "reminders",
  "memory",
  "contract",
  "self_reports",
  "metric_snapshots",
  /** Not a data source: the response-budget enforcer, which can shed a section. */
  "budget",
] as const;
export type FamiliarDashboardSource = (typeof FAMILIAR_DASHBOARD_SOURCES)[number];

/**
 * The closed set of machine-readable reasons a section is less than `fresh`.
 *
 * These are the ONLY strings that cross the API boundary to describe a failure.
 * They are literals — never interpolated, never derived from an error message,
 * a path, a stack, or a daemon response — because a redaction pass that has to
 * be *correct* on adversarial input is a redaction pass that will eventually be
 * wrong. Not emitting the text at all cannot leak it.
 *
 * The minimum a client needs to act is: which surface is degraded, and is it
 * worth retrying. That is the source tag plus the code. Everything past that —
 * which file, which host, which token, which line — is operator diagnostics
 * that belongs in the Cave's own logs, never in a response a phone receives
 * over a tailnet.
 */
export const FAMILIAR_DASHBOARD_ISSUE_CODES = [
  "familiar_unavailable",
  "sessions_unavailable",
  "sessions_degraded",
  "tasks_unavailable",
  "reminders_unavailable",
  "memory_unavailable",
  "contract_unavailable",
  "self_reports_unavailable",
  "metric_snapshots_unavailable",
  /** The honest payload did not fit the byte budget; this section was shed. */
  "response_budget_exceeded",
] as const;
export type FamiliarDashboardIssueCode =
  (typeof FAMILIAR_DASHBOARD_ISSUE_CODES)[number];

export type FamiliarDashboardIssue = {
  source: FamiliarDashboardSource;
  code: FamiliarDashboardIssueCode;
  /**
   * Whether asking again might get a different answer. A daemon that is down is
   * retryable; a familiar with no contract files on disk is not.
   */
  retryable: boolean;
};

export type DashboardSection<T> = {
  state: ServerDashboardSectionState;
  /** When this section's data was assembled, not when it was requested. */
  generatedAt: string;
  data: T | null;
  issues: FamiliarDashboardIssue[];
};

/** A bounded list that always tells the client how much it is not seeing. */
export type BoundedList<T> = {
  items: T[];
  /** Total available BEFORE the cap. `total > items.length` means bounded. */
  total: number;
};

export type FamiliarDashboardIdentity = {
  id: string;
  displayName: string;
  role: string | null;
  pronouns: string | null;
  avatarUrl: string | null;
  presence: string | null;
  lastSeen: string | null;
};

export type FamiliarDashboardSession = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  /** True for daemon runs with no human conversation behind them. */
  generated: boolean;
};

export type FamiliarDashboardMemoryEntry = {
  id: string;
  title: string;
  updatedAt: string;
  verification: string;
};

export type FamiliarDashboardTaskDependency = {
  id: string;
  kind: string;
  label: string;
};

export type FamiliarDashboardTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string | null;
  sessionId: string | null;
  updatedAt: string;
  unresolvedDependencies: BoundedList<FamiliarDashboardTaskDependency>;
  primaryBlockerId: string | null;
  nextStep: { summary: string; requiresApproval: boolean } | null;
};

export type FamiliarDashboardReminder = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  fireAt: string | null;
  firedAt: string | null;
  updatedAt: string;
  familiarId: string;
};

export type FamiliarDashboardAttention = {
  id: string;
  source: "task" | "reminder";
  kind: "blocked" | "review" | "fired_reminder";
  title: string;
  targetId: string;
};

/**
 * What this Familiar is doing right now.
 *
 * `idle` and `unknown` are deliberately different values. `idle` is a POSITIVE
 * claim — the session list was read and nothing is running — and a hub is
 * entitled to render it as a calm "nothing in flight". `unknown` is what the
 * server must say when the session source failed: it has no basis for either
 * answer, and collapsing that into `idle` is precisely the failure-as-absence
 * lie this contract exists to stop. Without the third case the section state
 * would carry the truth while `now` quietly contradicted it.
 */
export type FamiliarDashboardNow =
  | { kind: "session"; id: string; title: string; updatedAt: string }
  | { kind: "task"; id: string; title: string; nextStep: string; updatedAt: string }
  | { kind: "idle" }
  | { kind: "unknown" };

export type FamiliarOverview = {
  now: FamiliarDashboardNow;
  presence: string | null;
  live: {
    harness: string | null;
    model: string | null;
    activeSessionCount: number;
    memoryFreshestAt: string | null;
  };
  tasks: BoundedList<FamiliarDashboardTask>;
  sessions: {
    active: BoundedList<FamiliarDashboardSession>;
    recent: BoundedList<FamiliarDashboardSession>;
  };
  memory: {
    entries: BoundedList<FamiliarDashboardMemoryEntry>;
    /** Newest canonical-memory update for this familiar, or null. */
    freshestAt: string | null;
  };
  attention: BoundedList<FamiliarDashboardAttention>;
  reminders: BoundedList<FamiliarDashboardReminder>;
};

export type FamiliarProfile = {
  description: string | null;
  familiarType: string | null;
  runtime: {
    harness: string | null;
    defaultHarness: string | null;
    harnessOverride: string | null;
    model: string | null;
    /**
     * Where the effective model came from. `unconfigured` is a real, distinct
     * answer — it is not the same as "the Coven default happens to be null".
     */
    modelProvenance: "familiar" | "coven_default" | "unconfigured";
  };
  glyph: { icon: string | null; emoji: string | null; color: string | null };
  configuration: { note: string | null; autoSelfReport: boolean };
  contract: {
    propertiesPassed: number;
    propertiesTotal: number;
    violations: BoundedList<string>;
    warnings: BoundedList<string>;
  } | null;
};

export type FamiliarAnalyticsDigest = {
  /**
   * Every figure below is derived from `sampleSize` reports and no others. A
   * client that renders an average without its sample count invites the reader
   * to trust one report as though it were thirty.
   */
  sampleSize: number;
  /** Total reports on disk before the `reports` cap. */
  reportsTotal: number;
  windowStart: string | null;
  windowEnd: string | null;
  averages: {
    overallConfidence: number | null;
    toolReliability: number | null;
    memoryRecall: number | null;
    fileLocatability: number | null;
  };
  sessionPulse: { active: number; recent: number };
  /** Human-authored sessions only; generated runs are excluded. */
  activity: {
    availability: "available" | "unavailable";
    periodDays: typeof FAMILIAR_DASHBOARD_LIMITS.activityDays;
    days: Array<{ date: string; count: number }>;
    activeSessions: number | null;
    totalSessions: number | null;
    lastActiveAt: string | null;
  };
  confidence: {
    state: "measured" | "insufficient";
    band: ThreadConfidenceLabel | null;
    sampleCount: number;
    latestReportAt: string | null;
  };
  signalTrends: {
    availability: "available" | "unavailable";
    periodDays: 30;
    sampleCount: number;
    metrics: Array<{
      key: "confidence" | "toolReliability" | "memoryRecall" | "fileLocatability";
      label: string;
      direction: "improving" | "flat" | "regressing" | "insufficient";
      delta: number | null;
    }>;
  };
  memory: {
    state: "measured" | "insufficient";
    sampleCount: number;
    recall: number | null;
    fileLocatability: number | null;
    latestReportAt: string | null;
  };
  capabilities: {
    sampleCount: number;
    used: BoundedList<{ name: string; count: number }>;
    lacking: BoundedList<{ name: string; importance: string }>;
    vital: BoundedList<{ name: string; state: string }>;
  };
  attention: {
    sampleCount: number;
    contractGaps: number | null;
    persistentBlockers: BoundedList<{
      id: string;
      title: string;
      impact: string;
    }>;
  };
};

export type FamiliarDashboardSections = {
  overview: DashboardSection<FamiliarOverview>;
  profile: DashboardSection<FamiliarProfile>;
  analytics: DashboardSection<FamiliarAnalyticsDigest>;
};

export type FamiliarDashboardSuccess = {
  ok: true;
  version: typeof FAMILIAR_DASHBOARD_VERSION;
  familiarId: string;
  generatedAt: string;
  identity: FamiliarDashboardIdentity;
  sections: FamiliarDashboardSections;
};

/** The closed set of top-level refusals. Stable, redacted, enumerable. */
export const FAMILIAR_DASHBOARD_ERROR_CODES = [
  "invalid_familiar_id",
  "familiar_not_found",
  "unsupported_version",
  "dashboard_unavailable",
] as const;
export type FamiliarDashboardErrorCode =
  (typeof FAMILIAR_DASHBOARD_ERROR_CODES)[number];

export type FamiliarDashboardFailure = {
  ok: false;
  /**
   * Human-readable, and deliberately identical to the string the sibling
   * `/api/familiars/[id]/*` routes already return for the same condition, so a
   * client that switched on `error` before this route existed keeps working.
   */
  error: string;
  code: FamiliarDashboardErrorCode;
};

export type FamiliarDashboardResponse =
  | FamiliarDashboardSuccess
  | FamiliarDashboardFailure;

// --- pure helpers ----------------------------------------------------------

/**
 * Clamp one free-text field.
 *
 * Applied at PROJECTION time rather than at serialization time, so the bound
 * holds for every consumer of the DTO and not merely for the one that happens
 * to go over HTTP.
 */
export function clampDashboardText(
  value: unknown,
  limit: number = FAMILIAR_DASHBOARD_LIMITS.textCharacters,
): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

/** Clamp, but preserve the difference between "absent" and "present but empty". */
export function clampDashboardTextOrNull(
  value: unknown,
  limit: number = FAMILIAR_DASHBOARD_LIMITS.textCharacters,
): string | null {
  if (typeof value !== "string") return null;
  const clamped = clampDashboardText(value, limit);
  return clamped.length > 0 ? clamped : null;
}

/** Cap a list while recording the pre-cap total. */
export function boundList<T>(items: readonly T[], limit: number): BoundedList<T> {
  return { items: items.slice(0, Math.max(0, limit)), total: items.length };
}

/**
 * The deterministic state rule. The ONLY place a section state is decided.
 *
 * Order matters and is not arbitrary:
 *
 *   1. A failed REQUIRED source means the section cannot be rendered at all —
 *      `unavailable`, whatever else succeeded.
 *   2. Any issue at all means the section is incomplete — `partial`. This is
 *      checked BEFORE emptiness, which is the whole point: a section that read
 *      nothing *and* failed a source is `partial`, never `empty`.
 *   3. Content present, nothing wrong — `fresh`.
 *   4. Nothing wrong and nothing there — `empty`, a positive claim.
 */
export function classifyDashboardSectionState(input: {
  requiredFailed: boolean;
  issues: readonly FamiliarDashboardIssue[];
  hasContent: boolean;
}): ServerDashboardSectionState {
  if (input.requiredFailed) return "unavailable";
  if (input.issues.length > 0) return "partial";
  return input.hasContent ? "fresh" : "empty";
}

/**
 * Assemble a section, enforcing the biconditionals in the module note.
 *
 * `data` is dropped to null exactly when the state is `unavailable`, so a
 * client can branch on `data === null` alone and never be wrong about it.
 *
 * ## Why the required failure is an ISSUE and not a boolean
 *
 * This took `requiredFailed: boolean` first, and the exhaustive state test
 * immediately produced a combination the boolean allowed and honesty does not:
 * `requiredFailed: true` with an empty `issues` array — a section reporting
 * `unavailable` with no reason attached. That is the least actionable answer the
 * contract can give. The client knows only that something is wrong, cannot tell
 * a daemon outage (retry) from a missing workspace file (do not), and has
 * nothing to show the operator but a shrug.
 *
 * Making the parameter the issue itself removes the combination from the type
 * rather than from a convention: there is no way to reach `unavailable` without
 * naming a cause, so no future caller has to remember to. The issue is prepended
 * to `issues`, so the reason a section died is always the first thing a client
 * reads.
 */
export function buildDashboardSection<T>(input: {
  generatedAt: string;
  /**
   * The issue that makes this section unrenderable, or null when the section's
   * required sources all answered. Non-null forces `unavailable`.
   */
  requiredFailure: FamiliarDashboardIssue | null;
  /** Issues that degrade the section without preventing it from rendering. */
  issues: readonly FamiliarDashboardIssue[];
  data: T;
  hasContent: boolean;
}): DashboardSection<T> {
  const issues = input.requiredFailure
    ? [input.requiredFailure, ...input.issues]
    : [...input.issues];
  const state = classifyDashboardSectionState({
    requiredFailed: input.requiredFailure !== null,
    issues,
    hasContent: input.hasContent,
  });
  return {
    state,
    generatedAt: input.generatedAt,
    data: state === "unavailable" ? null : input.data,
    issues,
  };
}

// --- pure section builders -------------------------------------------------

export type OverviewSessionInput = {
  id: string;
  title?: string | null;
  status?: string | null;
  updated_at?: string | null;
  generated?: boolean;
};

export type OverviewMemoryInput = {
  id: string;
  title?: string | null;
  updatedAt?: string | null;
  verification?: { state?: string | null } | null;
};

export type OverviewTaskInput = {
  id: string;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  familiarId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  updatedAt?: string | null;
  dependencies?: readonly {
    id: string;
    kind?: string | null;
    label?: string | null;
    state?: string | null;
  }[];
  primaryBlockerId?: string | null;
  nextStep?: { summary?: string | null; requiresApproval?: boolean } | null;
};

export type OverviewReminderInput = {
  id: string;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  status?: string | null;
  fireAt?: string | null;
  firedAt?: string | null;
  updatedAt?: string | null;
  familiarId?: string | null;
};

function projectSession(session: OverviewSessionInput): FamiliarDashboardSession {
  return {
    id: clampDashboardText(session.id),
    title: clampDashboardText(session.title ?? ""),
    status: clampDashboardText(session.status ?? "unknown") || "unknown",
    updatedAt: clampDashboardText(session.updated_at ?? ""),
    generated: session.generated === true,
  };
}

/** Newest first, by `updated_at`. Ties break on id so ordering is total. */
function byUpdatedAtDesc(
  a: OverviewSessionInput,
  b: OverviewSessionInput,
): number {
  const left = Date.parse(a.updated_at ?? "");
  const right = Date.parse(b.updated_at ?? "");
  const leftMs = Number.isFinite(left) ? left : 0;
  const rightMs = Number.isFinite(right) ? right : 0;
  if (leftMs !== rightMs) return rightMs - leftMs;
  return a.id.localeCompare(b.id);
}

const RUNNING_STATUSES = new Set(["running", "starting"]);

export function buildFamiliarOverview(input: {
  sessions: readonly OverviewSessionInput[];
  memory: readonly OverviewMemoryInput[];
  tasks?: readonly OverviewTaskInput[];
  reminders?: readonly OverviewReminderInput[];
  presence: string | null;
  familiarId?: string;
  harness?: string | null;
  model?: string | null;
  /**
   * False when the session source failed. Drives `now` to `unknown` rather than
   * letting an empty list masquerade as `idle` — see FamiliarDashboardNow.
   */
  sessionsAvailable?: boolean;
  tasksAvailable?: boolean;
}): FamiliarOverview {
  const sessionsAvailable = input.sessionsAvailable ?? true;
  const tasksAvailable = input.tasksAvailable ?? true;
  const ordered = [...input.sessions].sort(byUpdatedAtDesc);
  const humanSessions = ordered.filter((session) => session.generated !== true);
  const active = humanSessions.filter((s) =>
    RUNNING_STATUSES.has((s.status ?? "").toLowerCase()),
  );
  const recent = humanSessions.filter(
    (s) => !RUNNING_STATUSES.has((s.status ?? "").toLowerCase()),
  );

  // "Now" prefers a running session a HUMAN is in. A generated run (a flow, an
  // automation, a journal narrative) is real work but it is not what the
  // operator is doing, and surfacing it as "now" makes the hub read as busy
  // when the person has nothing in flight.
  const nowSession = active[0] ?? null;

  const memoryOrdered = [...input.memory].sort((a, b) => {
    const left = Date.parse(a.updatedAt ?? "");
    const right = Date.parse(b.updatedAt ?? "");
    const leftMs = Number.isFinite(left) ? left : 0;
    const rightMs = Number.isFinite(right) ? right : 0;
    if (leftMs !== rightMs) return rightMs - leftMs;
    return a.id.localeCompare(b.id);
  });

  const freshest = memoryOrdered.find((entry) => {
    const parsed = Date.parse(entry.updatedAt ?? "");
    return Number.isFinite(parsed);
  });

  const statusRank = new Map([
    ["running", 0], ["review", 1], ["blocked", 2], ["inbox", 3], ["backlog", 4],
  ]);
  const priorityRank = new Map([["urgent", 0], ["high", 1], ["medium", 2], ["low", 3]]);
  const assigned = (input.tasks ?? [])
    .filter((task) => task.familiarId === input.familiarId && task.status !== "done")
    .sort((a, b) => {
      const status = (statusRank.get(a.status ?? "") ?? 99) - (statusRank.get(b.status ?? "") ?? 99);
      if (status !== 0) return status;
      const priority = (priorityRank.get(a.priority ?? "") ?? 99) - (priorityRank.get(b.priority ?? "") ?? 99);
      if (priority !== 0) return priority;
      return byTimestampDesc(a.updatedAt, b.updatedAt) || a.id.localeCompare(b.id);
    });
  const projectedTasks = assigned.map((task): FamiliarDashboardTask => {
    const unresolved = (task.dependencies ?? []).filter((dependency) => dependency.state === "unresolved");
    return {
      id: clampDashboardText(task.id),
      title: clampDashboardText(task.title ?? ""),
      status: clampDashboardText(task.status ?? "backlog") || "backlog",
      priority: clampDashboardText(task.priority ?? "medium") || "medium",
      projectId: clampDashboardTextOrNull(task.projectId),
      sessionId: clampDashboardTextOrNull(task.sessionId),
      updatedAt: clampDashboardText(task.updatedAt ?? ""),
      unresolvedDependencies: {
        items: unresolved.slice(0, FAMILIAR_DASHBOARD_LIMITS.taskDependencies).map((dependency) => ({
          id: clampDashboardText(dependency.id),
          kind: clampDashboardText(dependency.kind ?? "external") || "external",
          label: clampDashboardText(dependency.label ?? ""),
        })),
        total: unresolved.length,
      },
      primaryBlockerId: clampDashboardTextOrNull(task.primaryBlockerId),
      nextStep: task.nextStep?.summary
        ? {
            summary: clampDashboardText(task.nextStep.summary),
            requiresApproval: task.nextStep.requiresApproval === true,
          }
        : null,
    };
  });
  const scopedReminders = (input.reminders ?? [])
    .filter((reminder) => reminder.kind === "reminder" && reminder.familiarId === input.familiarId)
    .sort((a, b) => byTimestampAsc(a.fireAt, b.fireAt) || a.id.localeCompare(b.id))
    .map((reminder): FamiliarDashboardReminder => ({
      id: clampDashboardText(reminder.id),
      title: clampDashboardText(reminder.title ?? ""),
      body: clampDashboardTextOrNull(reminder.body),
      status: clampDashboardText(reminder.status ?? "pending") || "pending",
      fireAt: clampDashboardTextOrNull(reminder.fireAt),
      firedAt: clampDashboardTextOrNull(reminder.firedAt),
      updatedAt: clampDashboardText(reminder.updatedAt ?? ""),
      familiarId: clampDashboardText(reminder.familiarId ?? ""),
    }));

  const activeTask = projectedTasks.find((task) => task.status === "running" && task.nextStep !== null)
    ?? projectedTasks.find((task) => task.nextStep !== null)
    ?? null;
  const now: FamiliarDashboardNow = nowSession
      ? {
          kind: "session",
          id: clampDashboardText(nowSession.id),
          title: clampDashboardText(nowSession.title ?? ""),
          updatedAt: clampDashboardText(nowSession.updated_at ?? ""),
        }
      : !sessionsAvailable
        ? { kind: "unknown" }
        : activeTask
        ? {
            kind: "task",
            id: activeTask.id,
            title: activeTask.title,
            nextStep: activeTask.nextStep!.summary,
            updatedAt: activeTask.updatedAt,
          }
        : tasksAvailable
          ? { kind: "idle" }
          : { kind: "unknown" };

  const attention = [
    ...projectedTasks
      .filter((task) => task.status === "blocked" || task.status === "review")
      .map((task): FamiliarDashboardAttention => ({
        id: `task:${task.id}`,
        source: "task",
        kind: task.status === "blocked" ? "blocked" : "review",
        title: task.title,
        targetId: task.id,
      })),
    ...scopedReminders
      .filter((reminder) => reminder.status === "fired")
      .map((reminder): FamiliarDashboardAttention => ({
        id: `reminder:${reminder.id}`,
        source: "reminder",
        kind: "fired_reminder",
        title: reminder.title,
        targetId: reminder.id,
      })),
  ];

  return {
    now,
    presence: clampDashboardTextOrNull(input.presence),
    live: {
      harness: clampDashboardTextOrNull(input.harness),
      model: clampDashboardTextOrNull(input.model),
      activeSessionCount: active.length,
      memoryFreshestAt: freshest ? clampDashboardText(freshest.updatedAt ?? "") : null,
    },
    tasks: {
      items: projectedTasks.slice(0, FAMILIAR_DASHBOARD_LIMITS.assignedTasks),
      total: projectedTasks.length,
    },
    sessions: {
      active: {
        items: active
          .slice(0, FAMILIAR_DASHBOARD_LIMITS.activeSessions)
          .map(projectSession),
        total: active.length,
      },
      recent: {
        items: recent
          .slice(0, FAMILIAR_DASHBOARD_LIMITS.recentSessions)
          .map(projectSession),
        total: recent.length,
      },
    },
    memory: {
      entries: {
        items: memoryOrdered
          .slice(0, FAMILIAR_DASHBOARD_LIMITS.memoryEntries)
          .map((entry) => ({
            id: clampDashboardText(entry.id),
            title: clampDashboardText(entry.title ?? ""),
            updatedAt: clampDashboardText(entry.updatedAt ?? ""),
            verification: clampDashboardText(entry.verification?.state ?? "unknown") || "unknown",
          })),
        total: memoryOrdered.length,
      },
      freshestAt: freshest ? clampDashboardText(freshest.updatedAt ?? "") : null,
    },
    attention: {
      items: attention.slice(0, FAMILIAR_DASHBOARD_LIMITS.attention),
      total: attention.length,
    },
    reminders: {
      items: scopedReminders.slice(0, FAMILIAR_DASHBOARD_LIMITS.reminders),
      total: scopedReminders.length,
    },
  };
}

function byTimestampDesc(left: string | null | undefined, right: string | null | undefined): number {
  const a = Date.parse(left ?? "");
  const b = Date.parse(right ?? "");
  return (Number.isFinite(b) ? b : 0) - (Number.isFinite(a) ? a : 0);
}

function byTimestampAsc(left: string | null | undefined, right: string | null | undefined): number {
  const a = Date.parse(left ?? "");
  const b = Date.parse(right ?? "");
  return (Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER)
    - (Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER);
}

export type ProfileFamiliarInput = {
  description?: string | null;
  familiarType?: string | null;
  harness?: string | null;
  defaultHarness?: string | null;
  harnessOverride?: string | null;
  model?: string | null;
  configuredModel?: string | null;
  icon?: string | null;
  emoji?: string | null;
  color?: string | null;
  note?: string | null;
  autoSelfReport?: boolean;
};

export type ProfileContractInput = {
  properties: readonly { property: string; pass: boolean }[];
  violations: readonly { field?: string; message?: string }[];
  warnings: readonly { field?: string; message?: string }[];
};

function findingText(finding: { field?: string; message?: string }): string {
  // The contract evaluator's own field names and messages — Cave-authored
  // literals about SOUL.md / ward.toml structure, never file contents and never
  // a filesystem path. Clamped anyway so one long message cannot dominate the
  // section.
  const field = clampDashboardText(finding.field ?? "", 48);
  const message = clampDashboardText(finding.message ?? "", 160);
  return field ? `${field}: ${message}` : message;
}

export function buildFamiliarProfile(input: {
  familiar: ProfileFamiliarInput;
  contract: ProfileContractInput | null;
}): FamiliarProfile {
  const { familiar } = input;
  const model = clampDashboardTextOrNull(familiar.model);
  // Provenance is derived from WHICH input carried the value, not from
  // comparing the effective model against the default: a familiar that
  // explicitly pins the same model as the Coven default has genuinely made a
  // choice, and reporting that as `coven_default` would erase it.
  const modelProvenance: FamiliarProfile["runtime"]["modelProvenance"] =
    clampDashboardTextOrNull(familiar.configuredModel) !== null
      ? "familiar"
      : model !== null
        ? "coven_default"
        : "unconfigured";

  return {
    description: clampDashboardTextOrNull(familiar.description),
    familiarType: clampDashboardTextOrNull(familiar.familiarType),
    runtime: {
      harness: clampDashboardTextOrNull(familiar.harness),
      defaultHarness: clampDashboardTextOrNull(familiar.defaultHarness),
      harnessOverride: clampDashboardTextOrNull(familiar.harnessOverride),
      model,
      modelProvenance,
    },
    glyph: {
      icon: clampDashboardTextOrNull(familiar.icon),
      emoji: clampDashboardTextOrNull(familiar.emoji),
      color: clampDashboardTextOrNull(familiar.color),
    },
    configuration: {
      note: clampDashboardTextOrNull(familiar.note),
      autoSelfReport: familiar.autoSelfReport === true,
    },
    contract: input.contract
      ? {
          propertiesPassed: input.contract.properties.filter((p) => p.pass).length,
          propertiesTotal: input.contract.properties.length,
          violations: boundList(
            input.contract.violations.map(findingText),
            FAMILIAR_DASHBOARD_LIMITS.contractFindings,
          ),
          warnings: boundList(
            input.contract.warnings.map(findingText),
            FAMILIAR_DASHBOARD_LIMITS.contractFindings,
          ),
        }
      : null,
  };
}

export type AnalyticsReportInput = ThreadSelfReport;

export type AnalyticsSessionInput = {
  status?: string | null;
  updatedAt?: string | null;
  generated?: boolean | null;
};

/**
 * Mean of the finite values only, or null when there are none.
 *
 * `null` rather than `0`: a familiar whose reports never carried a memory-recall
 * score has NO memory-recall average, and rendering that as a zero would show a
 * failing bar for a measurement nobody took.
 */
function meanOrNull(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  const sum = finite.reduce((total, value) => total + value, 0);
  // Rounded so the wire value is stable across platforms rather than carrying
  // float noise that makes two identical runs serialize differently.
  return Math.round((sum / finite.length) * 1000) / 1000;
}

export function buildFamiliarAnalyticsDigest(input: {
  reports: readonly AnalyticsReportInput[];
  reportsTotal: number;
  activeSessions: number;
  recentSessions: number;
  sessions: readonly AnalyticsSessionInput[];
  sessionsAvailable: boolean;
  metricSnapshots: readonly ThreadMetricSnapshot[];
  metricSnapshotsAvailable: boolean;
  contractGapCount: number | null;
  now: Date;
}): FamiliarAnalyticsDigest {
  const sample = input.reports.slice(0, FAMILIAR_DASHBOARD_LIMITS.reports);
  const stamps = sample
    .map((report) => Date.parse(report.reportedAt ?? ""))
    .filter((value) => Number.isFinite(value));

  const latestReportAt = stamps.length > 0
    ? new Date(Math.max(...stamps)).toISOString()
    : null;
  const averages = {
    overallConfidence: meanOrNull(sample.map((r) => r.overallConfidence)),
    toolReliability: meanOrNull(sample.map((r) => r.toolReliability?.score)),
    memoryRecall: meanOrNull(sample.map((r) => r.memoryRecallScore)),
    fileLocatability: meanOrNull(sample.map((r) => r.fileLocatabilityScore)),
  };

  const humanSessions = input.sessions.filter((session) => session.generated !== true);
  const activityStart = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  ) - (FAMILIAR_DASHBOARD_LIMITS.activityDays - 1) * 86_400_000;
  const activityCounts = new Map<string, number>();
  const sessionStamps: number[] = [];
  const activitySessions: AnalyticsSessionInput[] = [];
  for (const session of humanSessions) {
    const stamp = Date.parse(session.updatedAt ?? "");
    if (!Number.isFinite(stamp)) continue;
    sessionStamps.push(stamp);
    if (stamp < activityStart || stamp >= activityStart + FAMILIAR_DASHBOARD_LIMITS.activityDays * 86_400_000) continue;
    activitySessions.push(session);
    const key = new Date(stamp).toISOString().slice(0, 10);
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }
  const activityDays = Array.from(
    { length: FAMILIAR_DASHBOARD_LIMITS.activityDays },
    (_, index) => {
      const date = new Date(activityStart + index * 86_400_000).toISOString().slice(0, 10);
      return { date, count: activityCounts.get(date) ?? 0 };
    },
  );

  const aggregate = aggregateThreadSignals(sample);
  const confidenceSampleCount = sample.filter(
    (report) => typeof report.overallConfidence === "number" && Number.isFinite(report.overallConfidence),
  ).length;
  const memorySampleCount = sample.filter((report) =>
    (typeof report.memoryRecallScore === "number" && Number.isFinite(report.memoryRecallScore))
    || (typeof report.fileLocatabilityScore === "number" && Number.isFinite(report.fileLocatabilityScore))
  ).length;
  const confidenceBand = averages.overallConfidence === null
    ? null
    : threadConfidenceLabel(averages.overallConfidence);
  const snapshots = input.metricSnapshots
    .filter((snapshot) => {
      const stamp = Date.parse(snapshot.reportedAt);
      return Number.isFinite(stamp)
        && stamp >= input.now.getTime() - 30 * 86_400_000
        && stamp <= input.now.getTime();
    })
    .slice(-FAMILIAR_DASHBOARD_LIMITS.metricSnapshots);
  const trends = deriveSignalTrends(
    snapshots,
    input.now.getTime(),
    undefined,
    { days: 30, label: "last 30 days" },
  );

  const usedCounts = new Map<string, number>();
  for (const report of sample) {
    for (const skillId of report.skillsUsed) {
      usedCounts.set(skillId, (usedCounts.get(skillId) ?? 0) + 1);
    }
  }
  const safeUsed = [...usedCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name: clampDashboardText(name), count }));
  const safeLacking = aggregate.capabilitiesLacking.map((item) => ({
    name: clampDashboardText(item.name),
    importance: item.importance,
  }));
  const safeVital = aggregate.capabilitiesVital.map((item) => ({
    name: clampDashboardText(item.name),
    state: item.currentState,
  }));
  const safeBlockers = aggregate.persistentBlockers.map((item) => ({
    id: clampDashboardText(item.id),
    title: clampDashboardText(item.title),
    impact: item.impact,
  }));

  return {
    sampleSize: sample.length,
    reportsTotal: input.reportsTotal,
    windowStart:
      stamps.length > 0 ? new Date(Math.min(...stamps)).toISOString() : null,
    windowEnd: stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null,
    averages,
    sessionPulse: { active: input.activeSessions, recent: input.recentSessions },
    activity: {
      availability: input.sessionsAvailable ? "available" : "unavailable",
      periodDays: FAMILIAR_DASHBOARD_LIMITS.activityDays,
      days: input.sessionsAvailable ? activityDays : [],
      activeSessions: input.sessionsAvailable
        ? activitySessions.filter((session) => session.status === "running").length
        : null,
      totalSessions: input.sessionsAvailable ? activitySessions.length : null,
      lastActiveAt: input.sessionsAvailable && sessionStamps.length > 0
        ? new Date(Math.max(...sessionStamps)).toISOString()
        : null,
    },
    confidence: {
      state: confidenceSampleCount > 0 ? "measured" : "insufficient",
      band: confidenceBand,
      sampleCount: confidenceSampleCount,
      latestReportAt,
    },
    signalTrends: {
      availability: input.metricSnapshotsAvailable ? "available" : "unavailable",
      periodDays: 30,
      sampleCount: input.metricSnapshotsAvailable ? trends.snapshotCount : 0,
      metrics: input.metricSnapshotsAvailable
        ? trends.metrics.map((metric) => ({
            key: metric.key,
            label: metric.key === "confidence"
              ? "Confidence"
              : metric.key === "toolReliability"
                ? "Tool reliability"
                : metric.key === "memoryRecall"
                  ? "Memory recall"
                  : "File finding",
            direction: metric.direction,
            delta: metric.delta,
          }))
        : [],
    },
    memory: {
      state: memorySampleCount > 0 ? "measured" : "insufficient",
      sampleCount: memorySampleCount,
      recall: averages.memoryRecall,
      fileLocatability: averages.fileLocatability,
      latestReportAt,
    },
    capabilities: {
      sampleCount: sample.length,
      used: boundList(safeUsed, FAMILIAR_DASHBOARD_LIMITS.analyticsItems),
      lacking: boundList(safeLacking, FAMILIAR_DASHBOARD_LIMITS.analyticsItems),
      vital: boundList(safeVital, FAMILIAR_DASHBOARD_LIMITS.analyticsItems),
    },
    attention: {
      sampleCount: sample.length,
      contractGaps: input.contractGapCount,
      persistentBlockers: boundList(safeBlockers, FAMILIAR_DASHBOARD_LIMITS.analyticsItems),
    },
  };
}

// --- byte budget -----------------------------------------------------------

/** Serialized size of a value in bytes, as it would go over the wire. */
export function serializedDashboardBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

/**
 * The order sections are shed in when the honest payload does not fit.
 *
 * Fixed and reviewed rather than computed from measured size, so two Caves
 * shedding under the same pressure shed the same thing: a client's degraded
 * screen is then reproducible instead of depending on which familiar happened
 * to have the longest session titles. Analytics goes first — it is a digest of
 * history, and losing it costs the operator the least; identity and the header
 * are never shed at all.
 */
const BUDGET_SHED_ORDER: (keyof FamiliarDashboardSections)[] = [
  "analytics",
  "overview",
  "profile",
];

/**
 * Enforce `responseBytes`. TOTAL: the returned payload is always within budget.
 *
 * A shed section is reported `unavailable` with `response_budget_exceeded`,
 * which is the honest answer — the client is genuinely not getting that data in
 * this response — and the code says why, so it is distinguishable from a source
 * that actually failed. It is NOT reported `empty`, and it is NOT silently
 * returned with fewer items and an unchanged state.
 *
 * The floor is reachable by construction: with all three sections shed the
 * payload is the envelope plus `identity`, every field of which is clamped to
 * `textCharacters`, so the minimum is a few hundred bytes against a 128 KiB
 * budget. That is why this can be total without a synthetic error case.
 */
export function enforceDashboardResponseBudget(
  response: FamiliarDashboardSuccess,
  limitBytes: number = FAMILIAR_DASHBOARD_LIMITS.responseBytes,
): { response: FamiliarDashboardSuccess; shed: (keyof FamiliarDashboardSections)[] } {
  if (serializedDashboardBytes(response) <= limitBytes) {
    return { response, shed: [] };
  }

  let current = response;
  const shed: (keyof FamiliarDashboardSections)[] = [];

  for (const name of BUDGET_SHED_ORDER) {
    const section = current.sections[name];
    // Already unavailable: dropping it again frees nothing and would append a
    // second issue describing a shed that did not happen.
    if (section.data !== null) {
      current = {
        ...current,
        sections: {
          ...current.sections,
          [name]: {
            state: "unavailable",
            generatedAt: section.generatedAt,
            data: null,
            issues: [
              ...section.issues,
              {
                source: "budget",
                code: "response_budget_exceeded",
                // Retrying is pointless while the underlying data is this
                // large; the client needs a narrower request, not a repeat.
                retryable: false,
              },
            ],
          },
        },
      };
      shed.push(name);
    }
    if (serializedDashboardBytes(current) <= limitBytes) break;
  }

  return { response: current, shed };
}
