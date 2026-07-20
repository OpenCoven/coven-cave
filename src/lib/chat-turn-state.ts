import type { ChatAttachment } from "@/lib/chat-attachments";
import type { ChatLinkedContext } from "@/lib/chat-linked-context";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import type { ChatStreamClientHealth } from "@/lib/chat-stream-health";
import { createLiveGenerationRegistry, type LiveGenerationSnapshot } from "@/lib/live-chat-generations";
import type { TurnUsage } from "@/lib/usage-format";

/**
 * The shared state contract for ChatView's persisted transcript and its
 * client-owned in-flight generation. Keeping this outside the component lets
 * an SSE reader continue accumulating safely after the visible view unmounts.
 */
export type ToolEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
  /**
   * Length of the turn text when this tool's first event arrived. Turn rows
   * use it to interleave tool activity with prose; legacy transcripts omit it
   * and keep the trailing rollup.
   */
  textOffset?: number;
};

export type ProgressEvent = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  createdAt: string;
  durationMs?: number;
};

export type ChatTurnLifecycle =
  | "queued"
  | "connecting"
  | "streaming"
  | "tooling"
  | "cancelled"
  | "failed"
  | "complete";

export type Turn = {
  id: string;
  parentId?: string | null;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ToolEvent[];
  progress?: ProgressEvent[];
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  lifecycle?: ChatTurnLifecycle;
  durationMs?: number;
  /** Token usage and cost from a harness result event. */
  usage?: TurnUsage;
  costUsd?: number;
  responseMetadata?: ChatResponseMetadata;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

export type ConversationHistoryTurn = {
  id: string;
  parentId?: string | null;
  role: string;
  text: string;
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ToolEvent[];
  durationMs?: number;
  isError?: boolean;
  usage?: TurnUsage;
  costUsd?: number;
  responseMetadata?: ChatResponseMetadata;
  cancelled?: boolean;
  createdAt?: string;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

export type ConversationHistoryPayload = {
  ok?: boolean;
  context?: ChatLinkedContext | null;
  conversation?: {
    activeLeafId?: string;
    turns?: ConversationHistoryTurn[];
  };
};

/** Normalize the API's permissive persisted turn shape for ChatView. */
export function mapConversationHistoryTurns(rawTurns: ConversationHistoryTurn[]): Turn[] {
  return rawTurns
    .filter(
      (turn): turn is ConversationHistoryTurn & { role: "user" | "assistant" } =>
        turn.role === "user" || turn.role === "assistant",
    )
    .map((turn) => ({
      id: turn.id,
      parentId: turn.parentId,
      role: turn.role,
      text: turn.text,
      attachments: turn.attachments,
      reasoning: turn.reasoning,
      tools: turn.tools,
      durationMs: turn.durationMs,
      usage: turn.usage,
      costUsd: turn.costUsd,
      responseMetadata: turn.responseMetadata,
      error: turn.isError,
      lifecycle: turn.cancelled ? ("cancelled" as const) : undefined,
      createdAt: turn.createdAt ?? new Date().toISOString(),
      origin: turn.origin,
      voiceCallId: turn.voiceCallId,
    }));
}

function cloneLiveTurn(turn: Turn): Turn {
  return {
    ...turn,
    attachments: turn.attachments ? [...turn.attachments] : undefined,
    tools: turn.tools ? turn.tools.map((tool) => ({ ...tool })) : undefined,
    progress: turn.progress ? turn.progress.map((progress) => ({ ...progress })) : undefined,
  };
}

export type LiveChatGenerationSnapshot = LiveGenerationSnapshot<Turn> & {
  runId?: string | null;
  streamHealth?: ChatStreamClientHealth;
};

export type LiveChatGenerationMetadata = {
  runId: string;
  streamHealth: ChatStreamClientHealth;
};

// A generation must outlive the ChatView instance that started it: thread
// switches and surface unmounts otherwise cause React to drop later state
// updates, freezing the visible snapshot mid-stream.
const liveChatRegistry = createLiveGenerationRegistry<Turn, LiveChatGenerationSnapshot>(cloneLiveTurn);

export function readLiveChatGeneration(sessionId: string): LiveChatGenerationSnapshot | null {
  return liveChatRegistry.read(sessionId);
}

export function recordLiveChatGeneration(snapshot: LiveChatGenerationSnapshot): LiveChatGenerationSnapshot {
  return liveChatRegistry.record(snapshot);
}

export function stageLiveChatGenerationMetadata(
  sessionId: string,
  metadata: LiveChatGenerationMetadata,
): LiveChatGenerationSnapshot | null {
  const current = liveChatRegistry.read(sessionId);
  if (!current || (current.runId != null && current.runId !== metadata.runId)) return null;
  return liveChatRegistry.stage(sessionId, (snapshot) => ({
    ...snapshot,
    ...metadata,
  }));
}

export function publishLiveChatGenerationMetadata(
  sessionId: string,
  metadata: LiveChatGenerationMetadata,
): LiveChatGenerationSnapshot | null {
  const staged = stageLiveChatGenerationMetadata(sessionId, metadata);
  return staged ? recordLiveChatGeneration(staged) : null;
}

export function advanceLiveChatGeneration(
  sessionId: string,
  updater: (turns: Turn[]) => Turn[],
  activeLeafId: string,
  metadata?: LiveChatGenerationMetadata,
): LiveChatGenerationSnapshot | null {
  if (metadata && !stageLiveChatGenerationMetadata(sessionId, metadata)) return null;
  return liveChatRegistry.advance(sessionId, updater, activeLeafId);
}

export function clearLiveChatGeneration(
  sessionId: string | null | undefined,
  expectedRunId?: string,
) {
  if (sessionId && expectedRunId) {
    const current = liveChatRegistry.read(sessionId);
    if (current?.runId != null && current.runId !== expectedRunId) return;
  }
  liveChatRegistry.clear(sessionId);
}

export function subscribeLiveChatGeneration(
  sessionId: string,
  listener: (snapshot: LiveChatGenerationSnapshot | null) => void,
) {
  return liveChatRegistry.subscribe(sessionId, listener);
}
