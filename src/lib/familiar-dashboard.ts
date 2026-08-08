import { buildFamiliarCardStats, type CanonicalMemoryAvailability } from "@/components/familiars-view-stats";
import { ACTIVE_SESSION_STATUSES } from "@/lib/chat-auto-archive";
import { isGeneratedChatSession } from "@/lib/chat-projects";
import type { FamiliarBinding } from "@/lib/cave-config";
import type { Card, TaskDependency, TaskNextStep } from "@/lib/cave-board-types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { ContractFiles, ContractReport } from "@/lib/familiar-contract";
import { deriveGrowthReport } from "@/lib/familiar-growth-signals";
import { deriveHealRequests, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import type { ProjectAccessLevel } from "@/lib/project-permissions";
import type { RetroFamiliarState } from "@/lib/retro-runs";
import { runtimeOwnsModelDefault } from "@/lib/runtime-models";
import { buildSessionPulse } from "@/lib/session-pulse";
import {
  deriveSignalTrends,
  type ThreadMetricSnapshot,
} from "@/lib/signal-trends";
import { deriveThreadConfidence } from "@/lib/thread-confidence";
import {
  aggregateThreadSignals,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";
import type { Familiar, SessionRow } from "@/lib/types";

export const FAMILIAR_DASHBOARD_VERSION = 1 as const;
export const FAMILIAR_DASHBOARD_LIMITS = {
  responseBytes: 128 * 1024,
  assignedTasks: 6,
  activeSessions: 3,
  recentSessions: 5,
  attention: 6,
  reminders: 5,
  accessProjects: 50,
  reports: 30,
  metricSnapshots: 100,
  metricTrailingDays: 30,
  sessionEvidence: 100,
  sessionPulseDays: 14,
} as const;

export type ServerDashboardSectionState =
  | "fresh"
  | "partial"
  | "empty"
  | "unavailable";
export type ClientDashboardSectionState =
  | ServerDashboardSectionState
  | "stale";

export type FamiliarDashboardSource =
  | "familiar"
  | "board"
  | "sessions"
  | "inbox"
  | "contract"
  | "access"
  | "memory"
  | "retro"
  | "self_reports"
  | "metric_snapshots"
  | "feedback";

export type FamiliarDashboardIssueCode =
  | "familiar_enrichment_unavailable"
  | "board_unavailable"
  | "sessions_unavailable"
  | "sessions_degraded"
  | "inbox_unavailable"
  | "contract_unavailable"
  | "access_unavailable"
  | "memory_unavailable"
  | "retro_roster_unavailable"
  | "retro_state_unavailable"
  | "self_reports_unavailable"
  | "metric_snapshots_unavailable"
  | "feedback_unavailable";

export type FamiliarDashboardIssue = {
  source: FamiliarDashboardSource;
  code: FamiliarDashboardIssueCode;
};

export type DashboardSection<T> = {
  state: ServerDashboardSectionState;
  generatedAt: string;
  data: T | null;
  issues: FamiliarDashboardIssue[];
};

export type FamiliarDashboardIdentity = {
  id: string;
  displayName: string;
  role: string;
  pronouns: string | null;
  avatarUrl: string | null;
  avatarRevision: string | null;
  presence: string | null;
  lastSeen: string | null;
  activeSessionCount: number | null;
};

export type FamiliarDashboardSession = {
  id: string;
  title: string;
  status: string;
  harness: string;
  model: string | null;
  updatedAt: string;
};

export type FamiliarDashboardReminder = {
  id: string;
  familiarId: string;
  title: string;
  body: string | null;
  status: string;
  fireAt: string | null;
  updatedAt: string;
};

export type FamiliarDashboardHealRequest = {
  id: string;
  severity: SelfHealRequest["severity"];
  title: string;
  detail: string;
  suggestedAction: string;
  actionKind: SelfHealRequest["actionKind"];
};

export type FamiliarDashboardAttention = {
  id: string;
  source: "task" | "heal" | "reminder";
  severity: "info" | "warn" | "crit";
  title: string;
  detail: string;
  target: {
    kind: "task" | "analytics" | "reminder";
    id: string;
  };
  updatedAt: string | null;
};

export type FamiliarDashboardTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  sessionId: string | null;
  updatedAt: string;
  dependencies: TaskDependency[];
  primaryBlocker: TaskDependency | null;
  nextStep: TaskNextStep | null;
};

export type FamiliarOverview = {
  live: {
    presence: string | null;
    harness: string | null;
    model: string | null;
    activeSessionCount: number | null;
    memoryFreshness: string | null;
    generatedAt: string;
  };
  now:
    | { kind: "session"; id: string; title: string; updatedAt: string }
    | { kind: "task"; id: string; title: string; nextStep: string; updatedAt: string }
    | { kind: "idle"; label: "No active work" };
  tasks: { items: FamiliarDashboardTask[]; total: number };
  sessions: {
    active: FamiliarDashboardSession[];
    activeTotal: number;
    recent: FamiliarDashboardSession[];
    recentTotal: number;
    totalNonGenerated: number;
  };
  attention: { items: FamiliarDashboardAttention[]; total: number };
  reminders: { items: FamiliarDashboardReminder[]; total: number };
};

export type FamiliarContractSummary = {
  specVersion: string;
  pass: boolean;
  propertyPassed: number;
  propertyTotal: number;
  violationCount: number;
  warningCount: number;
};

export type FamiliarAccessSummary = {
  projects: {
    items: Array<{
      id: string;
      name: string;
      access: ProjectAccessLevel;
    }>;
    total: number;
  };
  tools: Array<{
    id: "asana" | "x-research" | "x-publish";
    enabled: boolean;
    provenance: "inherited" | "explicit";
    workspaceGid: string | null;
  }>;
};

export type FamiliarProfile = {
  description: string | null;
  purpose: string | null;
  familiarType: string | null;
  glyph: {
    icon: string | null;
    emoji: string | null;
    color: string | null;
  };
  runtime: {
    harness: string | null;
    defaultHarness: string | null;
    harnessOverride: string | null;
    model: string | null;
    modelProvenance: "familiar" | "coven_default" | "unconfigured";
  };
  memoryFreshness: string | null;
  voice: { provider: string | null; model: string | null; name: string | null };
  image: {
    provider: string | null;
    model: string | null;
    size: string | null;
    quality: string | null;
  };
  configuration: {
    note: string | null;
    autoSelfReport: boolean;
    omnigent: {
      agentId: string | null;
      hostId: string | null;
      workspace: string | null;
    } | null;
  };
  contract: FamiliarContractSummary | null;
  access: FamiliarAccessSummary | null;
};

type AnalyticsMetadata = {
  definition: string;
  period: string;
  sampleCount: number;
  freshness: string | null;
};

export type FamiliarActivityDigest = AnalyticsMetadata & {
  pulse: ReturnType<typeof buildSessionPulse>;
  activeSessions: number;
  totalSessions: number;
  lastActiveAt: string | null;
  evidenceCount: number;
};

export type FamiliarConfidenceDigest = AnalyticsMetadata & {
  band: ReturnType<typeof deriveThreadConfidence>["label"] | null;
  latestReportAt: string | null;
  insufficientData: boolean;
};

export type FamiliarTrendDigest = AnalyticsMetadata & {
  granularity: ReturnType<typeof deriveSignalTrends>["granularity"];
  metrics: ReturnType<typeof deriveSignalTrends>["metrics"];
  buckets: ReturnType<typeof deriveSignalTrends>["buckets"];
};

export type FamiliarMemoryDigest = AnalyticsMetadata & {
  availability: CanonicalMemoryAvailability;
  count: number | null;
  latestUpdatedAt: string | null;
  averageRecall: number | null;
  averageFileLocatability: number | null;
};

export type FamiliarCapabilityDigest = AnalyticsMetadata & {
  used: Array<{ name: string; count: number }>;
  lacking: ReturnType<typeof aggregateThreadSignals>["capabilitiesLacking"];
  vital: ReturnType<typeof aggregateThreadSignals>["capabilitiesVital"];
};

export type FamiliarFeedbackDigest = AnalyticsMetadata & {
  state: "insufficient" | "regressing" | "stable";
  up: number;
  down: number;
  total: number;
  models: MessageFeedbackRollup["models"];
  runtimes: MessageFeedbackRollup["runtimes"];
};

export type FamiliarAnalyticsDigest = {
  activity: FamiliarActivityDigest;
  confidence: FamiliarConfidenceDigest;
  trends: FamiliarTrendDigest;
  memory: FamiliarMemoryDigest;
  capabilities: FamiliarCapabilityDigest;
  healRequests: FamiliarDashboardHealRequest[];
  feedback: FamiliarFeedbackDigest;
};

export type FamiliarDashboardResponse =
  | {
      ok: true;
      version: 1;
      familiarId: string;
      generatedAt: string;
      identity: FamiliarDashboardIdentity;
      sections: {
        overview: DashboardSection<FamiliarOverview>;
        profile: DashboardSection<FamiliarProfile>;
        analytics: DashboardSection<FamiliarAnalyticsDigest>;
      };
    }
  | {
      ok: false;
      error:
        | "invalid_familiar_id"
        | "familiar_not_found"
        | "dashboard_unavailable";
    };

export type DashboardSourceSuccess<T> = { ok: true; data: T };
export type DashboardSourceFailure<T = never> = {
  ok: false;
  source: FamiliarDashboardSource;
  code: FamiliarDashboardIssueCode;
  data?: T;
};
export type DashboardSourceResult<T> =
  | DashboardSourceSuccess<T>
  | DashboardSourceFailure<T>;

export function serializedDashboardBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function stringOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizedSessionStatus(status: string | null | undefined): string {
  return status?.trim().toLowerCase() ?? "";
}

function isActiveSessionStatus(status: string | null | undefined): boolean {
  return ACTIVE_SESSION_STATUSES.has(normalizedSessionStatus(status));
}

function isRunningSessionStatus(status: string | null | undefined): boolean {
  return normalizedSessionStatus(status) === "running";
}

function isVisibleNonGeneratedFamiliarSession(
  session: SessionRow,
  familiarId: string,
): boolean {
  return (
    session.familiarId === familiarId &&
    !session.archived_at &&
    !isGeneratedChatSession(session)
  );
}

function timestampValue(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function newestFirst<T>(
  left: T,
  right: T,
  timestamp: (value: T) => string | null | undefined,
  key: (value: T) => string,
): number {
  const delta = timestampValue(timestamp(right)) - timestampValue(timestamp(left));
  if (delta !== 0) return delta;
  return compareStrings(key(left), key(right));
}

function dashboardTask(card: Card): FamiliarDashboardTask {
  const dependencies = card.dependencies ?? [];
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    sessionId: card.sessionId,
    updatedAt: card.updatedAt,
    dependencies,
    primaryBlocker:
      dependencies.find((dependency) => dependency.id === card.primaryBlockerId) ?? null,
    nextStep: card.nextStep ?? null,
  };
}

function dashboardSession(session: SessionRow): FamiliarDashboardSession {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    harness: session.harness,
    model: session.model ?? null,
    updatedAt: session.updated_at,
  };
}

function dashboardReminder(item: InboxItem): FamiliarDashboardReminder {
  return {
    id: item.id,
    familiarId: item.familiarId as string,
    title: item.title,
    body: item.body ?? null,
    status: item.status,
    fireAt: item.fireAt ?? null,
    updatedAt: item.updatedAt,
  };
}

const TASK_PRIORITY_RANK: Record<Card["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const ATTENTION_SEVERITY_RANK: Record<FamiliarDashboardAttention["severity"], number> = {
  crit: 0,
  warn: 1,
  info: 2,
};

type FamiliarOverviewHealAttention = Pick<
  FamiliarDashboardHealRequest,
  "id" | "severity" | "title" | "detail"
> & {
  updatedAt: string | null;
};

export function buildDashboardSection<T>({
  generatedAt,
  required,
  optional,
  data,
  empty,
}: {
  generatedAt: string;
  required: DashboardSourceResult<unknown>[];
  optional: DashboardSourceResult<unknown>[];
  data: T | null;
  empty: boolean;
}): DashboardSection<T> {
  const failures = [...required, ...optional].filter(
    (result): result is DashboardSourceFailure<unknown> => !result.ok,
  );
  const requiredFailed = required.some((result) => !result.ok);
  const state: ServerDashboardSectionState =
    data === null
      ? requiredFailed
        ? "unavailable"
        : "empty"
      : requiredFailed
        ? "partial"
        : empty
          ? "empty"
          : "fresh";

  return {
    state,
    generatedAt,
    data,
    issues: failures.map(({ source, code }) => ({ source, code })),
  };
}

export function buildFamiliarOverview({
  familiarId,
  familiar,
  tasks,
  sessions,
  reminders,
  healRequests,
  now,
}: {
  familiarId: string;
  familiar: Familiar;
  tasks: Card[];
  sessions: SessionRow[];
  reminders: InboxItem[];
  healRequests: FamiliarOverviewHealAttention[];
  now: number;
}): FamiliarOverview {
  const generatedAt = new Date(now).toISOString();
  const assignedTasks = tasks
    .filter((card) => card.familiarId === familiarId && card.status !== "done")
    .sort((left, right) => {
      const priorityDelta = TASK_PRIORITY_RANK[left.priority] - TASK_PRIORITY_RANK[right.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return newestFirst(left, right, (card) => card.updatedAt, (card) => card.id);
    });
  const visibleSessions = sessions
    .filter((session) => isVisibleNonGeneratedFamiliarSession(session, familiarId))
    .sort((left, right) => newestFirst(left, right, (session) => session.updated_at, (session) => session.id));
  const activeSessions = visibleSessions.filter((session) =>
    isActiveSessionStatus(session.status),
  );
  const recentSessions = visibleSessions.filter(
    (session) => !isActiveSessionStatus(session.status),
  );
  const scopedReminders = reminders
    .filter(
      (item) =>
        item.kind === "reminder" &&
        item.familiarId === familiarId,
    )
    .sort((left, right) => {
      const firedDelta = Number(right.status === "fired") - Number(left.status === "fired");
      if (firedDelta !== 0) return firedDelta;
      return newestFirst(left, right, (item) => item.updatedAt, (item) => item.id);
    });
  const currentSession =
    visibleSessions.find((session) => isRunningSessionStatus(session.status)) ?? null;
  const nextTask = assignedTasks.find(
    (card) => Boolean(card.nextStep?.summary.trim()),
  );

  const taskAttention: FamiliarDashboardAttention[] = assignedTasks
    .filter((card) => card.status === "review" || card.status === "blocked")
    .map((card) => ({
      id: `task:${card.id}`,
      source: "task",
      severity: card.status === "blocked" ? "crit" : "warn",
      title: card.title,
      detail:
        card.status === "blocked"
          ? card.nextStep?.summary ?? "Resolve the primary blocker."
          : "Review the assigned task.",
      target: { kind: "task", id: card.id },
      updatedAt: card.updatedAt,
    }));
  const healAttention: FamiliarDashboardAttention[] = healRequests
    .map((request) => ({
      id: `heal:${request.id}`,
      source: "heal",
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      target: { kind: "analytics", id: request.id },
      updatedAt: request.updatedAt,
    }));
  const reminderAttention: FamiliarDashboardAttention[] = scopedReminders
    .filter((item) => item.status === "fired")
    .map((item) => ({
      id: `reminder:${item.id}`,
      source: "reminder",
      severity: "warn",
      title: item.title,
      detail: item.body ?? "Reminder is due.",
      target: { kind: "reminder", id: item.id },
      updatedAt: item.updatedAt,
    }));
  const attention = [
    ...taskAttention,
    ...healAttention,
    ...reminderAttention,
  ]
    .map((item, index) => ({ ...item, attentionIndex: index }))
    .sort((left, right) => {
      const severityDelta =
        ATTENTION_SEVERITY_RANK[left.severity] - ATTENTION_SEVERITY_RANK[right.severity];
      if (severityDelta !== 0) return severityDelta;
      const timestampDelta = timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
      if (timestampDelta !== 0) return timestampDelta;
      return left.attentionIndex - right.attentionIndex;
    })
    .map(({ attentionIndex: _attentionIndex, ...item }) => item);

  return {
    live: {
      presence: stringOrNull(familiar.status),
      harness: stringOrNull(familiar.harness),
      model: stringOrNull(familiar.model),
      activeSessionCount: familiar.active_sessions ?? null,
      memoryFreshness: stringOrNull(familiar.memory_freshness),
      generatedAt,
    },
    now: currentSession
      ? {
          kind: "session",
          id: currentSession.id,
          title: currentSession.title,
          updatedAt: currentSession.updated_at,
        }
      : nextTask
        ? {
            kind: "task",
            id: nextTask.id,
            title: nextTask.title,
            nextStep: nextTask.nextStep!.summary,
            updatedAt: nextTask.updatedAt,
          }
        : { kind: "idle", label: "No active work" },
    tasks: {
      items: assignedTasks
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.assignedTasks)
        .map(dashboardTask),
      total: assignedTasks.length,
    },
    sessions: {
      active: activeSessions
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.activeSessions)
        .map(dashboardSession),
      activeTotal: activeSessions.length,
      recent: recentSessions
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.recentSessions)
        .map(dashboardSession),
      recentTotal: recentSessions.length,
      totalNonGenerated: visibleSessions.length,
    },
    attention: {
      items: attention.slice(0, FAMILIAR_DASHBOARD_LIMITS.attention),
      total: attention.length,
    },
    reminders: {
      items: scopedReminders
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.reminders)
        .map(dashboardReminder),
      total: scopedReminders.length,
    },
  };
}

function purposeFromSoul(soul: string | null): string | null {
  if (!soul) return null;
  const lines = soul.split(/\r?\n/);
  const purposeHeading = lines.findIndex((line) => /^##\s+Purpose\s*$/i.test(line.trim()));
  if (purposeHeading >= 0) {
    for (const line of lines.slice(purposeHeading + 1)) {
      const trimmed = line.trim();
      if (/^##\s+/.test(trimmed)) break;
      if (trimmed) return trimmed;
    }
  }
  const sentence = soul.match(/\bMy purpose is ([^\r\n]+)/i);
  return sentence?.[1]?.trim() ?? null;
}

function modelProvenance(
  familiar: Pick<Familiar, "defaultHarness" | "harness" | "harnessOverride" | "model">,
  familiarId: string,
  config: {
    defaults: Pick<FamiliarBinding, "harness" | "model">;
    familiars: Record<string, Partial<FamiliarBinding>>;
  },
): FamiliarProfile["runtime"]["modelProvenance"] {
  if (config.familiars[familiarId]?.model?.trim()) return "familiar";
  if (!familiar.model?.trim()) return "unconfigured";

  const effectiveHarness =
    familiar.harnessOverride ??
    familiar.harness ??
    familiar.defaultHarness ??
    config.defaults.harness;

  if (runtimeOwnsModelDefault(effectiveHarness)) return "unconfigured";
  if (config.defaults.model?.trim() && familiar.model.trim() === config.defaults.model.trim()) {
    return "coven_default";
  }
  return "unconfigured";
}

export function buildFamiliarProfile({
  familiar,
  config,
  files,
  contractReport,
  projects,
}: {
  familiar: Familiar;
  config: {
    defaults: Pick<FamiliarBinding, "harness" | "model">;
    familiars: Record<string, Partial<FamiliarBinding>>;
  };
  files: ContractFiles;
  contractReport: ContractReport | null;
  projects: Array<{ project: CaveProject; access: ProjectAccessLevel }>;
}): FamiliarProfile {
  const rawAsana = config.familiars[familiar.id]?.asanaEnabled;
  const sortedProjects = [...projects].sort(
    (left, right) =>
      compareStrings(left.project.name, right.project.name) ||
      compareStrings(left.project.id, right.project.id),
  );

  return {
    description: stringOrNull(familiar.description),
    purpose: purposeFromSoul(files.soul),
    familiarType: stringOrNull(familiar.familiarType),
    glyph: {
      icon: stringOrNull(familiar.icon),
      emoji: stringOrNull(familiar.emoji),
      color: stringOrNull(familiar.color),
    },
    runtime: {
      harness: stringOrNull(familiar.harness),
      defaultHarness: stringOrNull(familiar.defaultHarness),
      harnessOverride: stringOrNull(familiar.harnessOverride),
      model: stringOrNull(familiar.model),
      modelProvenance: modelProvenance(familiar, familiar.id, config),
    },
    memoryFreshness: stringOrNull(familiar.memory_freshness),
    voice: {
      provider: stringOrNull(familiar.voiceProvider),
      model: stringOrNull(familiar.voiceModel),
      name: stringOrNull(familiar.voiceName),
    },
    image: {
      provider: stringOrNull(familiar.imageProvider),
      model: stringOrNull(familiar.imageModel),
      size: stringOrNull(familiar.imageSize),
      quality: stringOrNull(familiar.imageQuality),
    },
    configuration: {
      note: stringOrNull(familiar.note),
      autoSelfReport: familiar.autoSelfReport === true,
      omnigent: familiar.omnigent
        ? {
            agentId: stringOrNull(familiar.omnigent.agentId),
            hostId: stringOrNull(familiar.omnigent.hostId),
            workspace: stringOrNull(familiar.omnigent.workspace),
          }
        : null,
    },
    contract: contractReport
      ? {
          specVersion: contractReport.specVersion,
          pass: contractReport.pass,
          propertyPassed: contractReport.properties.filter((property) => property.pass).length,
          propertyTotal: contractReport.properties.length,
          violationCount: contractReport.violations.length,
          warningCount: contractReport.warnings.length,
        }
      : null,
    access: {
      projects: {
        items: sortedProjects.slice(0, FAMILIAR_DASHBOARD_LIMITS.accessProjects).map(({ project, access }) => ({
          id: project.id,
          name: project.name,
          access,
        })),
        total: sortedProjects.length,
      },
      tools: [
        {
          id: "asana",
          enabled: familiar.asanaEnabled !== false,
          provenance: rawAsana === undefined ? "inherited" : "explicit",
          workspaceGid: familiar.asanaWorkspaceGid ?? null,
        },
        {
          id: "x-research",
          enabled: familiar.xResearchEnabled === true,
          provenance: "explicit",
          workspaceGid: null,
        },
        {
          id: "x-publish",
          enabled: familiar.xPublishEnabled === true,
          provenance: "explicit",
          workspaceGid: null,
        },
      ],
    },
  };
}

export function buildFamiliarAnalyticsDigest({
  familiarId,
  familiar,
  sessions,
  reports,
  reportTotal: _reportTotal,
  snapshots,
  snapshotTotal: _snapshotTotal,
  memories,
  memoryAvailability,
  retroState,
  contractReport,
  feedback,
  now,
}: {
  familiarId: string;
  familiar: Familiar;
  sessions: SessionRow[];
  reports: ThreadSelfReport[];
  reportTotal: number;
  snapshots: ThreadMetricSnapshot[];
  snapshotTotal: number;
  memories: CanonicalMemorySummary[];
  memoryAvailability: CanonicalMemoryAvailability;
  retroState: RetroFamiliarState | null;
  contractReport: ContractReport | null;
  feedback: MessageFeedbackRollup;
  now: number;
}): FamiliarAnalyticsDigest {
  const nonGeneratedSessions = sessions
    .filter((session) => isVisibleNonGeneratedFamiliarSession(session, familiarId))
    .sort((left, right) => newestFirst(left, right, (session) => session.updated_at, (session) => session.id));
  const evidenceSessions = nonGeneratedSessions.slice(
    0,
    FAMILIAR_DASHBOARD_LIMITS.sessionEvidence,
  );
  const boundedReports = [...reports]
    .sort((left, right) => newestFirst(left, right, (report) => report.reportedAt, (report) => report.id))
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.reports);
  const metricCutoff =
    now - FAMILIAR_DASHBOARD_LIMITS.metricTrailingDays * 24 * 60 * 60_000;
  const boundedSnapshots = snapshots
    .filter((snapshot) => {
      const reportedAt = Date.parse(snapshot.reportedAt);
      return reportedAt >= metricCutoff && reportedAt <= now;
    })
    .sort((left, right) => newestFirst(left, right, (snapshot) => snapshot.reportedAt, (snapshot) => snapshot.id))
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.metricSnapshots)
    .sort((left, right) => {
      const delta = timestampValue(left.reportedAt) - timestampValue(right.reportedAt);
      if (delta !== 0) return delta;
      return compareStrings(left.id, right.id);
    });
  const reportAggregate = aggregateThreadSignals(boundedReports);
  const confidence = deriveThreadConfidence(boundedReports);
  const pulse = buildSessionPulse(
    nonGeneratedSessions,
    familiarId,
    now,
    FAMILIAR_DASHBOARD_LIMITS.sessionPulseDays,
  );
  const trends = deriveSignalTrends(
    boundedSnapshots,
    now,
    undefined,
    { days: 30, label: "last 30 days" },
  );
  const scopedMemories = memories.filter((memory) => memory.familiarId === familiarId);
  const stats = buildFamiliarCardStats({
    familiars: [familiar],
    sessions: nonGeneratedSessions,
    covenEntries: scopedMemories,
    memoryAvailability,
    now,
  }).get(familiarId)!;
  const growth = deriveGrowthReport({ familiar, stats, retroState, now });
  const hasGrowthEvidence =
    stats.sessionsTotal > 0 ||
    stats.memoryCount > 0 ||
    (retroState?.runs.length ?? 0) > 0;
  const healRequests = deriveHealRequests({
    familiarId,
    contractReport,
    growthReport: hasGrowthEvidence ? growth : null,
  });
  const latestReportAt = boundedReports[0]?.reportedAt ?? null;
  const latestMemoryAt = [...scopedMemories]
    .sort((left, right) => newestFirst(left, right, (memory) => memory.updatedAt, (memory) => memory.id))[0]?.updatedAt ?? null;
  const boundedReportCount = boundedReports.length;
  const boundedSnapshotCount = boundedSnapshots.length;
  const feedbackState =
    feedback.total < 5
      ? "insufficient"
      : feedback.up / feedback.total < 0.6
        ? "regressing"
        : "stable";

  return {
    activity: {
      definition: "Non-generated Familiar sessions by UTC calendar day.",
      period: "last 14 days",
      sampleCount: evidenceSessions.length,
      freshness: evidenceSessions[0]?.updated_at ?? null,
      pulse,
      activeSessions: nonGeneratedSessions.filter((session) =>
        isActiveSessionStatus(session.status),
      ).length,
      totalSessions: nonGeneratedSessions.length,
      lastActiveAt: evidenceSessions[0]?.updated_at ?? null,
      evidenceCount: evidenceSessions.length,
    },
    confidence: {
      definition: "Named band derived from the latest thread self-reports.",
      period: "latest 30 reports",
      sampleCount: boundedReportCount,
      freshness: latestReportAt,
      band: confidence.hasData ? confidence.label : null,
      latestReportAt,
      insufficientData: !confidence.hasData,
    },
    trends: {
      definition: "Metric direction across persisted thread snapshots.",
      period: trends.scopeLabel,
      sampleCount: boundedSnapshotCount,
      freshness: boundedSnapshots.at(-1)?.reportedAt ?? null,
      granularity: trends.granularity,
      metrics: trends.metrics,
      buckets: trends.buckets,
    },
    memory: {
      definition: "Canonical memory availability and report-backed recall signals.",
      period: "current memory plus latest 30 reports",
      sampleCount: boundedReportCount,
      freshness: latestMemoryAt,
      availability: memoryAvailability,
      count: memoryAvailability === "ready" ? scopedMemories.length : null,
      latestUpdatedAt: latestMemoryAt,
      averageRecall: boundedReports.length > 0 ? reportAggregate.averageMemoryRecall : null,
      averageFileLocatability:
        boundedReports.length > 0 ? reportAggregate.averageFileLocatability : null,
    },
    capabilities: {
      definition: "Capabilities observed across the latest thread self-reports.",
      period: "latest 30 reports",
      sampleCount: boundedReportCount,
      freshness: latestReportAt,
      used: reportAggregate.skillsUsedMost.map(({ skillId, count }) => ({
        name: skillId,
        count,
      })),
      lacking: reportAggregate.capabilitiesLacking,
      vital: reportAggregate.capabilitiesVital,
    },
    healRequests: healRequests.map((request) => ({
      id: request.id,
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      suggestedAction: request.suggestedAction,
      actionKind: request.actionKind,
    })),
    feedback: {
      definition: "Final thumbs verdicts for messages attributed to this Familiar.",
      period: "all retained feedback",
      sampleCount: feedback.total,
      freshness: null,
      state: feedbackState,
      up: feedback.up,
      down: feedback.down,
      total: feedback.total,
      models: feedback.models,
      runtimes: feedback.runtimes,
    },
  };
}
