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
  return result.stopped || result.status === 404;
}

const GROUP_CHAT_STOP_RETRY_DELAY_MS = 50;
const GROUP_CHAT_STOP_TIMEOUT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function stopActiveGroupReplyRuns(args: {
  entries: readonly ActiveGroupReplyRun[];
  stopRun: (request: GroupChatStopRequest) => Promise<Omit<GroupChatStopResult, "runId">>;
  onError?: (result: GroupChatStopResult, entry: ActiveGroupReplyRun) => void;
  isEntryActive?: (entry: ActiveGroupReplyRun) => boolean;
  isStopScopeCurrent?: () => boolean;
  retryDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<GroupChatStopResult[]> {
  const isEntryActive = args.isEntryActive ?? (() => true);
  const isStopScopeCurrent = args.isStopScopeCurrent ?? (() => true);
  const now = args.now ?? (() => Date.now());
  const pause = args.sleep ?? sleep;
  const retryDelayMs = args.retryDelayMs ?? GROUP_CHAT_STOP_RETRY_DELAY_MS;
  const timeoutMs = args.timeoutMs ?? GROUP_CHAT_STOP_TIMEOUT_MS;
  const controllerGroups = new Map<AbortController, number>();
  for (const entry of args.entries) {
    controllerGroups.set(entry.controller, (controllerGroups.get(entry.controller) ?? 0) + 1);
  }
  const settled = await Promise.all(
    args.entries.map(async (entry) => {
      const deadline = now() + timeoutMs;
      let acceptable = false;
      let result: GroupChatStopResult = {
        runId: entry.runId,
        ok: false,
        stopped: false,
        status: null,
      };
      for (;;) {
        if (!isEntryActive(entry)) {
          acceptable = true;
          break;
        }
        try {
          const response = await args.stopRun({ runId: entry.runId });
          result = { runId: entry.runId, ...response };
        } catch (error) {
          result = {
            runId: entry.runId,
            ok: false,
            stopped: false,
            status: null,
            error: error instanceof Error ? error.message : "stop failed",
          };
        }
        if (result.stopped) {
          acceptable = true;
          break;
        }
        if (!isEntryActive(entry)) {
          acceptable = true;
          break;
        }
        const retryable = isStopScopeCurrent() && now() < deadline;
        if (!retryable) {
          if (!result.error && isEntryActive(entry)) {
            result = {
              ...result,
              error: now() >= deadline ? "stop timed out" : "stop failed",
            };
          }
          break;
        }
        await pause(retryDelayMs);
      }
      return { entry, result, acceptable };
    }),
  );
  for (const [controller] of controllerGroups) controller.abort();
  for (const { entry, result, acceptable } of settled) {
    if (!acceptable && !isAcceptableStopResult(result)) {
      args.onError?.(
        { ...result, error: stopFailureMessage(result) },
        entry,
      );
    }
  }
  return settled.map(({ result }) => result);
}
