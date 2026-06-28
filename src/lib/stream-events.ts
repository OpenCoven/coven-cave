import type { ChatAttachment } from "@/lib/chat-attachments";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import type { TurnUsage } from "@/lib/usage-format";

/**
 * Canonical discriminated union for chat stream (SSE) events emitted by
 * `/api/chat/send` and consumed by the chat view, group chat, and other
 * surfaces. This is the single source of truth — do not re-declare it inline.
 */
export type StreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; text: string }
  | { kind: "assistant_chunk"; text: string }
  | { kind: "attachment"; attachment: ChatAttachment }
  | {
      kind: "progress";
      id?: string;
      label: string;
      detail?: string;
      status?: "running" | "done" | "error";
      durationMs?: number;
    }
  | {
      kind: "tool_use";
      id?: string;
      name: string;
      input?: string;
      output?: string;
      status?: "running" | "ok" | "error";
      durationMs?: number;
    }
  | {
      kind: "done";
      durationMs?: number;
      isError?: boolean;
      sessionId?: string;
      usage?: TurnUsage;
      costUsd?: number;
      responseMetadata?: ChatResponseMetadata;
    }
  | { kind: "error"; message: string; code?: string };

/** Discriminator literal for every {@link StreamEvent} variant. */
export type StreamEventKind = StreamEvent["kind"];

/** Narrow a {@link StreamEvent} to a specific variant by its `kind`. */
export function isStreamEvent<K extends StreamEventKind>(
  ev: StreamEvent,
  kind: K,
): ev is Extract<StreamEvent, { kind: K }> {
  return ev.kind === kind;
}
