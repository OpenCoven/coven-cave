export type ActiveGroupReplyRun = {
  runId: string;
  replyId: string;
  groupId: string;
  familiarId: string;
  sessionId: string | null;
  scopeId: number;
  controller: AbortController;
};

export type GroupChatStopRequest = {
  runId: string;
  sessionId: string | null;
};

export type GroupChatStopResult = {
  runId: string;
  ok: boolean;
  stopped: boolean;
  status: number | null;
  error?: string;
};

export function newGroupReplyRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `group-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function registerActiveGroupReplyRun(
  registry: Map<string, ActiveGroupReplyRun>,
  entry: ActiveGroupReplyRun,
): ActiveGroupReplyRun {
  registry.set(entry.runId, entry);
  return entry;
}

export function updateActiveGroupReplyRunSession(
  registry: Map<string, ActiveGroupReplyRun>,
  runId: string,
  sessionId: string,
): void {
  const entry = registry.get(runId);
  if (!entry) return;
  entry.sessionId = sessionId;
}

export function unregisterActiveGroupReplyRun(
  registry: Map<string, ActiveGroupReplyRun>,
  runId: string,
): void {
  registry.delete(runId);
}

export function listActiveGroupReplyRuns(
  registry: Map<string, ActiveGroupReplyRun>,
  scopeId: number,
): ActiveGroupReplyRun[] {
  return [...registry.values()].filter((entry) => entry.scopeId === scopeId);
}

function stopFailureMessage(result: GroupChatStopResult): string {
  if (result.error) return result.error;
  if (result.status != null) return `stop failed (${result.status})`;
  return "stop failed";
}

function isAcceptableStopResult(result: GroupChatStopResult): boolean {
  return result.ok || result.status === 404;
}

export async function stopActiveGroupReplyRuns(args: {
  entries: readonly ActiveGroupReplyRun[];
  stopRun: (request: GroupChatStopRequest) => Promise<Omit<GroupChatStopResult, "runId">>;
  onError?: (result: GroupChatStopResult, entry: ActiveGroupReplyRun) => void;
}): Promise<GroupChatStopResult[]> {
  return Promise.all(
    args.entries.map(async (entry) => {
      let result: GroupChatStopResult;
      try {
        const response = await args.stopRun({
          runId: entry.runId,
          sessionId: entry.sessionId,
        });
        result = { runId: entry.runId, ...response };
      } catch (error) {
        result = {
          runId: entry.runId,
          ok: false,
          stopped: false,
          status: null,
          error: error instanceof Error ? error.message : "stop failed",
        };
      } finally {
        entry.controller.abort();
      }
      if (!isAcceptableStopResult(result)) {
        args.onError?.(
          { ...result, error: stopFailureMessage(result) },
          entry,
        );
      }
      return result;
    }),
  );
}
