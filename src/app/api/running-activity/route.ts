import { NextResponse } from "next/server";
import { computeSessionsList } from "@/lib/server/sessions-list";
import { loadBoard } from "@/lib/cave-board";
import { listRuns as listAutomationRuns } from "@/lib/automation-runs";
import { listFlowRuns } from "@/lib/server/flow-store";
import { listRuns as listWorkflowRuns } from "@/lib/workflow-runs";
import { sessionStatusTone } from "@/lib/session-status";
import {
  automationActivityItems,
  boardTaskActivityItems,
  buildRunningActivityPayload,
  flowActivityItems,
  sessionActivityItems,
  workflowActivityItems,
  type RunningActivityItem,
  type RunningActivitySourceInput,
} from "@/lib/running-activity";
import type { SessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export async function GET() {
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
