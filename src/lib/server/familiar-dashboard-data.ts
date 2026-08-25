/**
 * Server-side assembly of the Familiar dashboard read (cave-9rwd.1).
 *
 * Every source is loaded through an injected dependency, captured
 * INDEPENDENTLY, and converted to either data or one stable issue code. Nothing
 * here formats HTTP; the route maps the outcome below to a status, and the pure
 * projection lives in `@/lib/familiar-dashboard`.
 *
 * ## Independent capture is the point
 *
 * The loads are wrapped one at a time rather than run under a single
 * `Promise.all` with one `catch`, because a shared catch makes every section as
 * unavailable as the unluckiest source — a familiar whose contract files are
 * simply absent would blank its sessions too. Isolating them is what lets one
 * response be truthful at different granularities in different sections.
 *
 * `Promise.allSettled` (not `Promise.all`) runs them concurrently while keeping
 * that isolation: a rejection in one never short-circuits a sibling that had
 * already succeeded.
 *
 * ## No self-fetching
 *
 * None of these dependencies is an HTTP call back into Cave's own routes. A
 * self-fetch would double the request cost, deadlock against a single-threaded
 * dev server, re-run the ingress gate against a request that has already passed
 * it, and — worst here — make a READ inherit the write side effects of whatever
 * route it borrowed. `loadSessions` is the concrete case: `/api/sessions/list`
 * archives sessions in cave state as a side effect of being polled, so this
 * calls `computeSessionsList` directly with the sweeps and git subprocesses
 * switched OFF (see `@/lib/server/sessions-list`).
 *
 * ## Redaction
 *
 * A caught error is never read. Not its `message`, not its `cause`, not its
 * `code` — the value is discarded at the catch and a literal from the issue-code
 * registry is emitted in its place. Cave's daemon errors routinely carry socket
 * paths and workspace paths, and `familiar-self-reports` throws
 * `new Error("path not allowed")` built from a familiar id, so anything derived
 * from a thrown value is a leak waiting for the right input. Discarding beats
 * scrubbing: there is no adversarial string that defeats "we did not look".
 *
 * Source DATA is redacted rather than discarded, per item, with
 * `redactSecretsDeep` — session titles, memory excerpts and self-report notes
 * are all free text a familiar authored. Per item, not per collection, because
 * `redactSecretsDeep` collapses an over-budget value to the scalar
 * "[redacted]", and doing that to a whole array turns it into a string (cave-p9dsb).
 */

import {
  buildDashboardSection,
  buildFamiliarAnalyticsDigest,
  buildFamiliarOverview,
  clampDashboardText,
  clampDashboardTextOrNull,
  enforceDashboardResponseBudget,
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  type FamiliarDashboardIdentity,
  type FamiliarDashboardIssue,
  type FamiliarDashboardSuccess,
  type OverviewMemoryInput,
  type OverviewReminderInput,
  type OverviewSessionInput,
  type OverviewTaskInput,
} from "@/lib/familiar-dashboard";
import { bindingFor, loadConfig, type CaveConfig } from "@/lib/cave-config";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import { canonicalMemoryList } from "@/lib/server/canonical-memory-gateway";
import { evaluateFamiliarContract, type ContractReport } from "@/lib/familiar-contract";
import { deriveHealRequests } from "@/lib/familiar-heal-requests";
import { readFamiliarContractFiles } from "@/lib/server/familiar-contract-files";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";
import {
  loadVisibleFamiliarRoster,
  type VisibleFamiliarRosterEntry,
  type VisibleFamiliarRosterResult,
} from "@/lib/server/familiar-roster";
import { computeSessionsList } from "@/lib/server/sessions-list";
import { listMetricSnapshots, listSelfReports } from "@/lib/server/familiar-self-reports";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import { buildFamiliarProfile } from "@/lib/familiar-dashboard";
import type { ThreadMetricSnapshot } from "@/lib/signal-trends";
import type { SessionRow } from "@/lib/types";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import { loadBoard } from "@/lib/cave-board";
import { loadInbox } from "@/lib/cave-inbox";
import type { Card } from "@/lib/cave-board-types";
import type { InboxItem } from "@/lib/cave-inbox";

export type FamiliarDashboardSessions = {
  sessions: SessionRow[];
  /** The list route's own "the daemon was down, these are local-only" flag. */
  degraded: boolean;
};

export type FamiliarDashboardDependencies = {
  loadRoster: () => Promise<VisibleFamiliarRosterResult>;
  loadConfig: () => Promise<CaveConfig>;
  resolveAvatar: (familiarId: string) => Promise<{ mtimeMs: number } | null>;
  loadSessions: (familiarId: string) => Promise<FamiliarDashboardSessions>;
  loadTasks: () => Promise<Card[]>;
  loadReminders: () => Promise<InboxItem[]>;
  loadMemory: () => Promise<CanonicalMemorySummary[]>;
  loadContract: (familiarId: string) => Promise<ContractReport>;
  loadSelfReports: (
    familiarId: string,
  ) => Promise<{ reports: ThreadSelfReport[]; total: number }>;
  loadMetricSnapshots: (
    familiarId: string,
  ) => Promise<{ snapshots: ThreadMetricSnapshot[]; total: number }>;
};

export function familiarDashboardDependencies(): FamiliarDashboardDependencies {
  return Object.freeze({
    loadRoster: loadVisibleFamiliarRoster,
    loadConfig,
    resolveAvatar: resolveFamiliarAvatar,
    loadSessions: async (familiarId: string) => {
      // sweepArchives:false — a dashboard GET must not archive the operator's
      // chats. enrichGit:false — the DTO renders no branch or diffstat, and
      // git subprocesses are not a bounded mobile read.
      const result = await computeSessionsList(false, familiarId, false, {
        sweepArchives: false,
        enrichGit: false,
      });
      if (!result.payload.ok) throw new Error("sessions unavailable");
      return {
        // Analytics needs only the latest bounded evidence set. Keep the list
        // route broad for its own UI, but never pass its entire history into a
        // dashboard read.
        sessions: result.payload.sessions.slice(0, FAMILIAR_DASHBOARD_LIMITS.metricSnapshots),
        degraded: result.payload.degraded === true,
      };
    },
    loadMemory: canonicalMemoryList,
    loadTasks: async () => (await loadBoard()).cards,
    loadReminders: async () => (await loadInbox()).items,
    loadContract: async (familiarId: string) => {
      const { files } = await readFamiliarContractFiles(familiarId);
      const report = evaluateFamiliarContract(files);
      return report;
    },
    loadSelfReports: (familiarId: string) =>
      listSelfReports(familiarId, { limit: FAMILIAR_DASHBOARD_LIMITS.reports }),
    loadMetricSnapshots: (familiarId: string) =>
      listMetricSnapshots(familiarId, { limit: FAMILIAR_DASHBOARD_LIMITS.metricSnapshots }),
  });
}

/**
 * A source either produced data or failed. The failure carries no detail
 * because none was read — see the module note on redaction.
 */
type SourceOutcome<T> = { ok: true; data: T } | { ok: false };

async function capture<T>(load: () => Promise<T>): Promise<SourceOutcome<T>> {
  const [settled] = await Promise.allSettled([load()]);
  return settled.status === "fulfilled"
    ? { ok: true, data: settled.value }
    : // The rejection reason is deliberately not bound to a name here. There is
      // no branch below that could consult it even by accident.
      { ok: false };
}

export type FamiliarDashboardLoadResult =
  | { outcome: "ok"; response: FamiliarDashboardSuccess }
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

function identityFor(
  entry: VisibleFamiliarRosterEntry,
  config: CaveConfig,
  avatarMtimeMs: number | null,
): FamiliarDashboardIdentity {
  const binding = bindingFor(config, entry.id);
  return {
    id: clampDashboardText(entry.id),
    displayName:
      clampDashboardTextOrNull(binding.display_name) ??
      clampDashboardTextOrNull(entry.display_name) ??
      clampDashboardText(entry.id),
    role: clampDashboardTextOrNull(binding.role ?? entry.role),
    pronouns: clampDashboardTextOrNull(binding.pronouns ?? entry.pronouns),
    avatarUrl:
      avatarMtimeMs === null
        ? null
        : `/api/familiars/${encodeURIComponent(entry.id)}/avatar?v=${Math.round(
            avatarMtimeMs,
          )}&format=png`,
    presence: clampDashboardTextOrNull(entry.status),
    lastSeen: clampDashboardTextOrNull(entry.last_seen),
  };
}

export async function loadFamiliarDashboard(input: {
  familiarId: string;
  dependencies?: FamiliarDashboardDependencies;
  now?: Date;
}): Promise<FamiliarDashboardLoadResult> {
  const dependencies = input.dependencies ?? familiarDashboardDependencies();
  const generatedAt = (input.now ?? new Date()).toISOString();
  const { familiarId } = input;

  // The roster is the only source whose failure is not survivable, and it is
  // loaded first for that reason. Without it there is no identity to render and
  // — more importantly — no way to tell "this familiar does not exist" from
  // "we could not find out". Answering 404 on a daemon outage would tell a
  // paired client its familiar had been deleted, which is a lie that survives
  // in the client's cache long after the daemon comes back. So a roster failure
  // is `unavailable` (503), never `not_found`.
  const roster = await capture(dependencies.loadRoster);
  if (!roster.ok || !roster.data.ok) return { outcome: "unavailable" };

  const entry = roster.data.roster.find((candidate) => candidate.id === familiarId);
  if (!entry) return { outcome: "not_found" };

  const [config, avatar, sessions, memory, tasks, reminders, contract, selfReports, metricSnapshots] = await Promise.all([
    capture(dependencies.loadConfig),
    capture(() => dependencies.resolveAvatar(familiarId)),
    capture(() => dependencies.loadSessions(familiarId)),
    capture(dependencies.loadMemory),
    capture(dependencies.loadTasks),
    capture(dependencies.loadReminders),
    capture(() => dependencies.loadContract(familiarId)),
    capture(() => dependencies.loadSelfReports(familiarId)),
    capture(() => dependencies.loadMetricSnapshots(familiarId)),
  ]);

  // Config failure is survivable but not silent: without it the roster's own
  // display name and role still render, so identity degrades rather than
  // disappearing, and the sections that depend on the binding report it.
  const effectiveConfig: CaveConfig | null = config.ok ? config.data : null;
  const identity = effectiveConfig
    ? identityFor(entry, effectiveConfig, avatar.ok && avatar.data ? avatar.data.mtimeMs : null)
    : {
        id: clampDashboardText(entry.id),
        displayName: clampDashboardTextOrNull(entry.display_name) ?? clampDashboardText(entry.id),
        role: clampDashboardTextOrNull(entry.role),
        pronouns: clampDashboardTextOrNull(entry.pronouns),
        avatarUrl: null,
        presence: clampDashboardTextOrNull(entry.status),
        lastSeen: clampDashboardTextOrNull(entry.last_seen),
      };

  // --- overview ------------------------------------------------------------
  const overviewIssues: FamiliarDashboardIssue[] = [];
  if (!sessions.ok) {
    overviewIssues.push({
      source: "sessions",
      code: "sessions_unavailable",
      retryable: true,
    });
  } else if (sessions.data.degraded) {
    // The list came back, but from local transcripts only because the daemon
    // was unreachable. Reporting that as `fresh` would present a
    // known-incomplete list as the whole truth.
    overviewIssues.push({
      source: "sessions",
      code: "sessions_degraded",
      retryable: true,
    });
  }
  if (!memory.ok) {
    overviewIssues.push({ source: "memory", code: "memory_unavailable", retryable: true });
  }
  if (!tasks.ok) {
    overviewIssues.push({ source: "tasks", code: "tasks_unavailable", retryable: true });
  }
  if (!reminders.ok) {
    overviewIssues.push({ source: "reminders", code: "reminders_unavailable", retryable: true });
  }

  const sessionInputs: OverviewSessionInput[] = sessions.ok
    ? sessions.data.sessions.map((session) => {
        const safe = redactSecretsDeep(session);
        return {
          id: String(safe.id ?? session.id),
          title: typeof safe.title === "string" ? safe.title : "",
          status: typeof safe.status === "string" ? safe.status : "unknown",
          updated_at: typeof safe.updated_at === "string" ? safe.updated_at : "",
          generated: session.generated === true,
        };
      })
    : [];

  const memoryInputs: OverviewMemoryInput[] = memory.ok
    ? memory.data
        .filter((summary) => summary.familiarId === familiarId)
        .map((summary) => {
          const safe = redactSecretsDeep(summary);
          return {
            id: String(safe.id ?? summary.id),
            title: typeof safe.title === "string" ? safe.title : "",
            updatedAt: typeof safe.updatedAt === "string" ? safe.updatedAt : "",
            verification: { state: summary.verification?.state ?? null },
          };
        })
    : [];

  const taskInputs: OverviewTaskInput[] = tasks.ok
    ? tasks.data.map((task) => {
        const safe = redactSecretsDeep(task);
        return {
          id: String(safe.id ?? task.id),
          title: typeof safe.title === "string" ? safe.title : "",
          status: task.status,
          priority: task.priority,
          familiarId: task.familiarId,
          projectId: task.projectId ?? null,
          sessionId: task.sessionId,
          updatedAt: task.updatedAt,
          dependencies: (task.dependencies ?? []).map((dependency) => ({
            id: dependency.id,
            kind: dependency.kind,
            label: clampDashboardText(dependency.label),
            state: dependency.state,
          })),
          primaryBlockerId: task.primaryBlockerId ?? null,
          nextStep: task.nextStep
            ? {
                summary: clampDashboardText(task.nextStep.summary),
                requiresApproval: task.nextStep.requiresApproval,
              }
            : null,
        };
      })
    : [];

  const reminderInputs: OverviewReminderInput[] = reminders.ok
    ? reminders.data.map((reminder) => {
        const safe = redactSecretsDeep(reminder);
        return {
          id: String(safe.id ?? reminder.id),
          kind: reminder.kind,
          title: typeof safe.title === "string" ? safe.title : "",
          body: typeof safe.body === "string" ? safe.body : null,
          status: reminder.status,
          fireAt: reminder.fireAt,
          firedAt: reminder.firedAt,
          updatedAt: reminder.updatedAt,
          familiarId: reminder.familiarId,
        };
      })
    : [];

  const overviewBinding = effectiveConfig ? bindingFor(effectiveConfig, familiarId) : null;

  const overviewData = buildFamiliarOverview({
    sessions: sessionInputs,
    memory: memoryInputs,
    tasks: taskInputs,
    reminders: reminderInputs,
    presence: identity.presence,
    familiarId,
    harness: overviewBinding?.harness ?? null,
    model: overviewBinding?.model ?? null,
    sessionsAvailable: sessions.ok,
    tasksAvailable: tasks.ok,
  });

  const overview = buildDashboardSection({
    generatedAt,
    // Survivable: identity alone still makes a renderable header, and the
    // issues say which parts of the body are missing.
    requiredFailure: null,
    issues: overviewIssues,
    data: overviewData,
    hasContent:
      overviewData.sessions.active.total > 0 ||
      overviewData.sessions.recent.total > 0 ||
      overviewData.memory.entries.total > 0 ||
      overviewData.tasks.total > 0 ||
      overviewData.reminders.total > 0 ||
      overviewData.attention.total > 0 ||
      overviewData.presence !== null ||
      overviewData.live.harness !== null ||
      overviewData.live.model !== null,
  });

  // --- profile -------------------------------------------------------------
  const profileIssues: FamiliarDashboardIssue[] = [];
  if (!contract.ok) {
    profileIssues.push({
      source: "contract",
      code: "contract_unavailable",
      // The contract evaluator reads files off disk. A failure here is a
      // workspace problem, not a transient one; retrying will read the same
      // absent or unreadable files again.
      retryable: false,
    });
  }
  if (!config.ok) {
    profileIssues.push({ source: "familiar", code: "familiar_unavailable", retryable: true });
  }

  const binding = effectiveConfig ? bindingFor(effectiveConfig, familiarId) : null;
  const configEntry = effectiveConfig?.familiars[familiarId] ?? {};
  const profileData = buildFamiliarProfile({
    familiar: {
      description: binding?.description ?? entry.description ?? null,
      familiarType: binding?.familiarType ?? null,
      harness: binding?.harness ?? null,
      defaultHarness: effectiveConfig?.defaults.harness ?? null,
      harnessOverride: configEntry.harness ?? null,
      model: binding?.model ?? null,
      configuredModel: configEntry.model ?? null,
      icon: entry.icon ?? null,
      emoji: entry.emoji ?? null,
      color: binding?.color ?? null,
      note: binding?.note ?? null,
      autoSelfReport: configEntry.autoSelfReport === true,
    },
    contract: contract.ok ? contract.data : null,
  });

  const profile = buildDashboardSection({
    generatedAt,
    requiredFailure: null,
    issues: profileIssues,
    data: profileData,
    hasContent:
      profileData.description !== null ||
      profileData.runtime.harness !== null ||
      profileData.runtime.model !== null ||
      profileData.contract !== null,
  });

  // --- analytics -----------------------------------------------------------
  // Self-reports are REQUIRED here: every figure in the digest is derived from
  // them, so without them the section has no basis at all and reporting an
  // all-null digest would invite the client to render zeroes for measurements
  // that were never read. An absent self-reports directory is NOT a failure —
  // listSelfReports returns an empty list — so this reaches `unavailable` only
  // when the read genuinely broke.
  const analyticsIssues: FamiliarDashboardIssue[] = [];
  const analyticsRequiredFailure: FamiliarDashboardIssue | null = selfReports.ok
    ? null
    : { source: "self_reports", code: "self_reports_unavailable", retryable: true };
  if (!sessions.ok) {
    analyticsIssues.push({
      source: "sessions",
      code: "sessions_unavailable",
      retryable: true,
    });
  }
  if (!metricSnapshots.ok) {
    analyticsIssues.push({
      source: "metric_snapshots",
      code: "metric_snapshots_unavailable",
      retryable: true,
    });
  }
  if (!contract.ok) {
    analyticsIssues.push({
      source: "contract",
      code: "contract_unavailable",
      retryable: false,
    });
  }

  const analyticsData = buildFamiliarAnalyticsDigest({
    reports: selfReports.ok
      ? selfReports.data.reports.map((report) => redactSecretsDeep(report))
      : [],
    reportsTotal: selfReports.ok ? selfReports.data.total : 0,
    activeSessions: overviewData.sessions.active.total,
    recentSessions: overviewData.sessions.recent.total,
    sessions: sessions.ok
      ? sessionInputs.map((session) => ({
          status: session.status,
          updatedAt: session.updated_at,
          generated: session.generated,
        }))
      : [],
    sessionsAvailable: sessions.ok,
    metricSnapshots: metricSnapshots.ok ? metricSnapshots.data.snapshots : [],
    metricSnapshotsAvailable: metricSnapshots.ok,
    memory: memoryInputs,
    memoryAvailable: memory.ok,
    contractGapCount: contract.ok ? contract.data.violations.length : null,
    healRequests: contract.ok
      ? deriveHealRequests({ familiarId, contractReport: contract.data, growthReport: null })
      : [],
    now: input.now ?? new Date(),
  });

  const analytics = buildDashboardSection({
    generatedAt,
    requiredFailure: analyticsRequiredFailure,
    issues: analyticsIssues,
    data: analyticsData,
    hasContent:
      analyticsData.sampleSize > 0 ||
      (analyticsData.activity.totalSessions ?? 0) > 0 ||
      analyticsData.memory.total !== null && analyticsData.memory.total > 0 ||
      analyticsData.attention.healRequests.total > 0,
  });

  const assembled: FamiliarDashboardSuccess = {
    ok: true,
    version: FAMILIAR_DASHBOARD_VERSION,
    familiarId: identity.id,
    generatedAt,
    identity,
    sections: { overview, profile, analytics },
  };

  // Enforced here rather than at the route, so every consumer of this loader —
  // including one that never serializes to HTTP — gets a payload that honours
  // the published budget and says so when it had to shed a section.
  return { outcome: "ok", response: enforceDashboardResponseBudget(assembled).response };
}
