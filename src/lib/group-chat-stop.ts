import {
  stopChatRunWithRetry,
  type ChatStopRequest,
  type ChatStopResult,
  type ChatStopState,
  type ChatStopTerminalOutcome,
} from "./chat-stop.ts";

export type ActiveGroupReplyRun = {
  runId: string;
  replyId: string;
  groupId: string;
  familiarId: string;
  sessionId: string | null;
  scopeId: number;
  controller: AbortController;
  terminalOutcome: GroupChatTerminalOutcome | null;
};

export type GroupChatStopRequest = ChatStopRequest;
export type GroupChatStopState = ChatStopState;
export type GroupChatTerminalOutcome = ChatStopTerminalOutcome;
export type GroupChatStopResult = ChatStopResult;

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
  return result.stopped || result.state === "transport-settled" || result.status === 404;
}

export async function stopActiveGroupReplyRuns(args: {
  entries: readonly ActiveGroupReplyRun[];
  stopRun: (request: GroupChatStopRequest) => Promise<Omit<GroupChatStopResult, "runId">>;
  onError?: (result: GroupChatStopResult, entry: ActiveGroupReplyRun) => void;
  isEntryActive?: (entry: ActiveGroupReplyRun) => boolean;
  abortLocalOnTransportSettled?: boolean;
  retryDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<GroupChatStopResult[]> {
  const isEntryActive = args.isEntryActive ?? (() => true);
  const settled = await Promise.all(
    args.entries.map(async (entry) => {
      const result = await stopChatRunWithRetry({
        runId: entry.runId,
        stopRun: args.stopRun,
        isActive: () => isEntryActive(entry),
        abortLocalOnTransportSettled: args.abortLocalOnTransportSettled,
        retryDelayMs: args.retryDelayMs,
        timeoutMs: args.timeoutMs,
        now: args.now,
        sleep: args.sleep,
      });
      const acceptable = result.stopped || result.state === "transport-settled" || result.status === 404 || !isEntryActive(entry);
      if (result.state === "transport-settled") entry.terminalOutcome = result.terminalOutcome;
      const shouldAbortLocal = result.stopped ||
        result.status === 404 ||
        (result.state === "transport-settled"
          ? args.abortLocalOnTransportSettled ?? false
          : !acceptable && isEntryActive(entry));
      return { entry, result, acceptable, shouldAbortLocal };
    }),
  );
  const controllerGroups = new Map<AbortController, boolean>();
  for (const { entry, shouldAbortLocal } of settled) {
    controllerGroups.set(entry.controller, Boolean(controllerGroups.get(entry.controller)) || shouldAbortLocal);
  }
  for (const [controller, shouldAbortLocal] of controllerGroups) {
    if (shouldAbortLocal) controller.abort();
  }
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
