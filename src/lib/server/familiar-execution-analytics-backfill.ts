import type {
  ConversationFile,
  ConversationSummary,
} from "../cave-conversations.ts";
import type { ExecutionAttemptSnapshotV1 } from "../familiars/familiar-execution-analytics.ts";
import { projectConversationExecutionAttempts } from "./familiar-execution-analytics-projection.ts";

export type ExecutionAnalyticsBackfillDependencies = {
  listConversations: () => Promise<ConversationSummary[]>;
  loadConversation: (sessionId: string) => Promise<ConversationFile | null>;
};

export type ExecutionAnalyticsBackfillResult = {
  attempts: ExecutionAttemptSnapshotV1[];
  toAppend: ExecutionAttemptSnapshotV1[];
  conversationsScanned: number;
  conversationsLoaded: number;
};

function sameSnapshot(
  left: ExecutionAttemptSnapshotV1,
  right: ExecutionAttemptSnapshotV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merge best-effort conversation projections with the local ledger. Live
 * snapshots remain authoritative; a newer deterministic backfill projection
 * may replace only an older backfill row for the same attempt identity.
 */
export async function backfillFamiliarExecutionAttempts(args: {
  familiarId: string;
  existing: ExecutionAttemptSnapshotV1[];
  dependencies: ExecutionAnalyticsBackfillDependencies;
}): Promise<ExecutionAnalyticsBackfillResult> {
  const summaries = (await args.dependencies.listConversations())
    .filter((summary) => summary.familiarId === args.familiarId);
  const byId = new Map(
    args.existing
      .filter((attempt) => attempt.familiarId === args.familiarId)
      .map((attempt) => [attempt.attemptId, attempt]),
  );
  const toAppend: ExecutionAttemptSnapshotV1[] = [];
  let conversationsLoaded = 0;

  for (const summary of summaries) {
    let conversation: ConversationFile | null = null;
    try {
      conversation = await args.dependencies.loadConversation(summary.sessionId);
    } catch {
      continue;
    }
    if (!conversation || conversation.familiarId !== args.familiarId) continue;
    conversationsLoaded += 1;
    for (const projected of projectConversationExecutionAttempts(conversation)) {
      const current = byId.get(projected.attemptId);
      if (current?.provenance.source === "live") continue;
      if (current && sameSnapshot(current, projected)) continue;
      byId.set(projected.attemptId, projected);
      toAppend.push(projected);
    }
  }

  return {
    attempts: [...byId.values()].sort((a, b) => (
      Date.parse(b.timing.completedAt) - Date.parse(a.timing.completedAt) ||
      a.attemptId.localeCompare(b.attemptId)
    )),
    toAppend,
    conversationsScanned: summaries.length,
    conversationsLoaded,
  };
}
