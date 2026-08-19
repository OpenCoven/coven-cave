import {
  listConversations,
  loadConversation,
} from "../cave-conversations.ts";
import {
  buildFamiliarExecutionAnalytics,
  type FamiliarExecutionAnalytics,
} from "../familiar-execution-analytics.ts";
import {
  backfillFamiliarExecutionAttempts,
  type ExecutionAnalyticsBackfillDependencies,
} from "./familiar-execution-analytics-backfill.ts";
import {
  appendExecutionAttemptSnapshots,
  listExecutionAttemptSnapshots,
} from "./familiar-execution-analytics-store.ts";

export type FamiliarExecutionAnalyticsSourceDependencies =
  ExecutionAnalyticsBackfillDependencies & {
    listStoredAttempts: typeof listExecutionAttemptSnapshots;
    appendAttempts: typeof appendExecutionAttemptSnapshots;
  };

const DEFAULT_DEPENDENCIES: FamiliarExecutionAnalyticsSourceDependencies = {
  listConversations,
  loadConversation,
  listStoredAttempts: listExecutionAttemptSnapshots,
  appendAttempts: appendExecutionAttemptSnapshots,
};

export async function readFamiliarExecutionAnalytics(args: {
  familiarId: string;
  now?: Date;
  recentLimit?: number;
  dependencies?: Partial<FamiliarExecutionAnalyticsSourceDependencies>;
}): Promise<FamiliarExecutionAnalytics> {
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...args.dependencies,
  };
  const existing = await dependencies.listStoredAttempts(args.familiarId);
  const backfill = await backfillFamiliarExecutionAttempts({
    familiarId: args.familiarId,
    existing,
    dependencies,
  });
  if (backfill.toAppend.length) {
    // Derived persistence is a cache: a temporarily unwritable ledger must not
    // hide analytics that can still be projected from local conversations.
    await dependencies.appendAttempts(args.familiarId, backfill.toAppend)
      .catch(() => 0);
  }
  const analytics = buildFamiliarExecutionAnalytics({
    familiarId: args.familiarId,
    attempts: backfill.attempts,
    now: args.now,
    recentLimit: args.recentLimit,
  });
  return {
    ...analytics,
    backfill: {
      state: backfill.conversationsLoaded === backfill.conversationsScanned
        ? "complete"
        : "partial",
      imported: backfill.toAppend.length,
      ...(backfill.conversationsLoaded < backfill.conversationsScanned
        ? {
            remaining: backfill.conversationsScanned -
              backfill.conversationsLoaded,
          }
        : {}),
    },
  };
}
