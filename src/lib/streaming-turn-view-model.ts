import type {
  ChatTurnLifecycle,
  ProgressEvent,
  ToolEvent,
  VerifiedResultEvidence,
} from "./chat-turn-state.ts";
import type { TurnResult, TurnResultState } from "./chat-result-markers.ts";
import {
  partitionStreamingMarkdown,
  type StreamingContentBlock,
} from "./streaming-markdown-blocks.ts";

export type StreamingTurnStatus = "working" | "answering" | "complete" | "interrupted" | "failed";

export type ActivityEvent = {
  id: string;
  label: string;
  state: "running" | "complete" | "notice" | "failed";
  source: "progress" | "tool";
  detail?: string;
  durationMs?: number;
};

export type StreamingTurnViewModel = {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  activity: ActivityEvent[];
  currentActivity: ActivityEvent | null;
  results: TurnResult[];
  status: StreamingTurnStatus;
  committedText: string;
  emptySuccessful: boolean;
};

export type StreamingTurnInput = {
  turnId: string;
  visibleText: string;
  pending: boolean;
  lifecycle?: ChatTurnLifecycle;
  failed?: boolean;
  progress?: readonly ProgressEvent[];
  tools?: readonly ToolEvent[];
  authoredResults?: readonly TurnResult[];
  verifiedResults?: readonly VerifiedResultEvidence[];
};

const TOOL_ACTIVITY: ReadonlyArray<[RegExp, string]> = [
  [/(grep|glob|search|find)/i, "Searching the chat implementation…"],
  [/(test|vitest|playwright)/i, "Running focused tests…"],
  [/(build|compile)/i, "Checking the production build…"],
  [/(diff|review)/i, "Reviewing the final changes…"],
];

function deriveStatus(input: StreamingTurnInput): StreamingTurnStatus {
  if (input.pending) return input.visibleText.length > 0 ? "answering" : "working";
  if (input.failed || input.lifecycle === "failed") return "failed";
  if (input.lifecycle === "cancelled") return "interrupted";
  return "complete";
}

function normalizeProgressEvent(progress: ProgressEvent): ActivityEvent {
  return {
    id: `progress:${progress.id}`,
    label: progress.label,
    state:
      progress.status === "running"
        ? "running"
        : progress.status === "done"
          ? "complete"
          : progress.status === "notice"
            ? "notice"
            : "failed",
    source: "progress",
    detail: progress.detail,
    durationMs: progress.durationMs,
  };
}

function readToolClassifier(tool: ToolEvent): string {
  const parts = [tool.name];
  if (typeof tool.input === "string" && tool.input.trim().length > 0) {
    parts.push(tool.input);
    try {
      const parsed = JSON.parse(tool.input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const command = (parsed as { command?: unknown }).command;
        if (typeof command === "string" && command.trim().length > 0) parts.push(command);
      }
    } catch {
      // Raw tool input may still help allowlisted classification.
    }
  }
  return parts.join(" ");
}

function toolActivityLabel(tool: ToolEvent): string {
  const classifier = readToolClassifier(tool);
  return TOOL_ACTIVITY.find(([pattern]) => pattern.test(classifier))?.[1] ?? "Working…";
}

function normalizeToolEvent(tool: ToolEvent): ActivityEvent {
  return {
    id: `tool:${tool.id}`,
    label: toolActivityLabel(tool),
    state: tool.status === "running" ? "running" : tool.status === "ok" ? "complete" : "failed",
    source: "tool",
    durationMs: tool.durationMs,
  };
}

function normalizeActivity(input: StreamingTurnInput): ActivityEvent[] {
  return [
    ...(input.progress ?? []).map(normalizeProgressEvent),
    ...(input.tools ?? []).map(normalizeToolEvent),
  ];
}

function findLast<Activity extends ActivityEvent>(
  activity: readonly Activity[],
  predicate: (event: Activity) => boolean,
): Activity | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    if (predicate(activity[index])) return activity[index];
  }
  return null;
}

function selectCurrentActivity(activity: readonly ActivityEvent[]): ActivityEvent | null {
  return (
    findLast(activity, (event) => event.source === "progress" && event.state === "running") ??
    findLast(activity, (event) => event.source === "tool" && event.state === "running") ??
    activity.at(-1) ??
    null
  );
}

function toVerifiedTurnResult(result: VerifiedResultEvidence): TurnResult {
  return {
    id: result.id,
    label: result.label,
    state: result.state,
    source: "verified-event",
  };
}

function isTerminalResultState(state: TurnResultState): boolean {
  return state === "passed" || state === "attention" || state === "failed";
}

function mergeResults(
  authoredResults: readonly TurnResult[],
  verifiedResults: readonly VerifiedResultEvidence[],
): TurnResult[] {
  const order: string[] = [];
  const merged = new Map<string, TurnResult>();

  for (const result of authoredResults) {
    if (!merged.has(result.id)) order.push(result.id);
    merged.set(result.id, { ...result });
  }

  for (const result of verifiedResults) {
    if (!merged.has(result.id)) order.push(result.id);
    merged.set(result.id, toVerifiedTurnResult(result));
  }

  return order.map((id) => merged.get(id)!).filter(Boolean);
}

function trustedTerminalResults(
  verifiedResults: readonly VerifiedResultEvidence[],
): Map<string, TurnResult> {
  const terminals = new Map<string, TurnResult>();
  for (const result of verifiedResults) {
    if (!isTerminalResultState(result.state)) continue;
    terminals.set(result.id, toVerifiedTurnResult(result));
  }
  return terminals;
}

function settleInterruptedResults(
  results: readonly TurnResult[],
  trustedTerminals: ReadonlyMap<string, TurnResult>,
): TurnResult[] {
  return results.map((result) => {
    if (result.state !== "running") return result;
    return trustedTerminals.get(result.id) ?? { ...result, state: "pending" };
  });
}

function settleFailedResults(
  results: readonly TurnResult[],
  trustedTerminals: ReadonlyMap<string, TurnResult>,
): TurnResult[] {
  return results.map((result) => {
    if (result.state !== "running") return result;
    return trustedTerminals.get(result.id) ?? { ...result, state: "attention" };
  });
}

function settleResults(
  status: StreamingTurnStatus,
  authoredResults: readonly TurnResult[],
  verifiedResults: readonly VerifiedResultEvidence[],
): TurnResult[] {
  const merged = mergeResults(authoredResults, verifiedResults);
  const terminals = trustedTerminalResults(verifiedResults);
  if (status === "interrupted") return settleInterruptedResults(merged, terminals);
  if (status === "failed") return settleFailedResults(merged, terminals);
  return merged;
}

export function createStreamingTurnViewModel(input: StreamingTurnInput): StreamingTurnViewModel {
  const status = deriveStatus(input);
  const partition = partitionStreamingMarkdown(input.visibleText, {
    turnId: input.turnId,
    settled: status !== "working" && status !== "answering",
  });
  const activity = normalizeActivity(input);

  return {
    committedBlocks: partition.committedBlocks,
    activeBlock: partition.activeBlock,
    activity,
    currentActivity: selectCurrentActivity(activity),
    results: settleResults(status, input.authoredResults ?? [], input.verifiedResults ?? []),
    status,
    committedText: partition.committedText,
    emptySuccessful: status === "complete" && input.visibleText.trim().length === 0,
  };
}
