import { NextResponse } from "next/server";
import { computeSessionsList } from "@/lib/server/sessions-list";
import { loadBoard } from "@/lib/cave-board";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import {
  listRoutineRuns,
  listRoutines,
} from "@/lib/server/coven-automations-client";
import { listFlowRuns } from "@/lib/server/flow-store";
import { listRuns as listWorkflowRuns } from "@/lib/workflow-runs";
import { sessionStatusTone } from "@/lib/session-status";
import {
  automationActivityItems,
  boardTaskActivityItems,
  buildRunningActivityPayload,
  emptyRunningActivityPayload,
  flowActivityItems,
  sessionActivityItems,
  workflowActivityItems,
  type RunningActivityItem,
  type RunningActivitySourceInput,
} from "@/lib/running-activity";
import type { SessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const AUTOMATION_RUN_HISTORY_LIMIT = 20;
const AUTOMATION_RUN_FETCH_CONCURRENCY = 4;

/** Load one source and map it, isolating failures so a bad source can never
 *  sink the whole response (partial-source status). */
async function loadSource<T>(
  load: () => Promise<T>,
  map: (value: T) => RunningActivityItem[],
): Promise<RunningActivitySourceInput> {
  try {
    return { ok: true, items: map(await load()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/** The daemon run ledger is scoped per routine, so gather its live entries
 *  before mapping them into the shared activity vocabulary. */
async function listAutomationRuns(): Promise<AutomationRunRecord[]> {
  const routines = await listRoutines();
  const liveRuns: AutomationRunRecord[] = [];
  for (let index = 0; index < routines.length; index += AUTOMATION_RUN_FETCH_CONCURRENCY) {
    const batch = routines.slice(index, index + AUTOMATION_RUN_FETCH_CONCURRENCY);
    const runsByRoutine = await Promise.all(
      batch.map(async (routine) => {
        const runs = await listRoutineRuns(routine.id, AUTOMATION_RUN_HISTORY_LIMIT);
        return runs
          .filter((run) => run.status === "running")
          .map((run) => ({
            id: run.id,
            automationId: run.automationId,
            automationName: routine.name,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            status: "running" as const,
            exitCode: run.exitCode,
            summary: run.logJson ?? undefined,
          }));
      }),
    );
    liveRuns.push(...runsByRoutine.flat());
  }
  return liveRuns;
}

export async function GET() {
  // Browser E2E is explicitly daemon-less. The popover is mounted on every
  // desktop page, so letting its poll fall through would fan each test into
  // five real stores (including the Coven automation daemon) unless that
  // individual spec happened to know about this shell-owned endpoint.
  if (process.env.COVEN_CAVE_E2E === "1") {
    return NextResponse.json(emptyRunningActivityPayload());
  }

  // Sessions: read-only, subprocess-free projection (no archive sweeps, no git
  // enrichment) of the same list the workspace polls. A hard daemon outage is
  // honest partial-source status, not an empty-but-fine list.
  const sessionsSource = await loadSource(async (): Promise<SessionRow[]> => {
    const result = await computeSessionsList(false, null, false, {
      sweepArchives: false,
      enrichGit: false,
    });
    if (!result.payload.ok) throw new Error(result.payload.error || "daemon unavailable");
    return result.payload.sessions;
  }, (rows) =>
    sessionActivityItems(
      rows.filter((s) => !s.archived_at && sessionStatusTone(s.status) === "running"),
    ),
  );

  const [boardSource, automationsSource, flowsSource, workflowsSource] = await Promise.all([
    loadSource(() => loadBoard().then((board) => board.cards), boardTaskActivityItems),
    loadSource(() => listAutomationRuns(), automationActivityItems),
    loadSource(() => listFlowRuns(), flowActivityItems),
    loadSource(() => listWorkflowRuns(), workflowActivityItems),
  ]);

  const payload = buildRunningActivityPayload({
    sessions: sessionsSource,
    board: boardSource,
    automations: automationsSource,
    flows: flowsSource,
    workflows: workflowsSource,
  });
  return NextResponse.json(payload);
}
