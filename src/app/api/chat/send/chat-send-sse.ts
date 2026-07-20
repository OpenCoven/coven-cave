import type { StreamEvent } from "@/lib/stream-events";

/** Encode a resumable chat event using the stable SSE wire contract. */
export function chatSse(event: StreamEvent, seq?: number): Uint8Array {
  const id = seq != null ? `id: ${seq}\n` : "";
  return new TextEncoder().encode(`${id}data: ${JSON.stringify(event)}\n\n`);
}

const HEARTBEAT = new TextEncoder().encode(": hb\n\n");
const HEARTBEAT_INTERVAL_MS = 20_000;

/** Keep quiet long-running streams alive without exposing synthetic events. */
export function startChatSseHeartbeat(
  controller: ReadableStreamDefaultController<Uint8Array>,
  isDone: () => boolean,
): NodeJS.Timeout {
  const heartbeat = setInterval(() => {
    if (isDone()) {
      clearInterval(heartbeat);
      return;
    }
    try {
      controller.enqueue(HEARTBEAT);
    } catch {
      clearInterval(heartbeat);
    }
  }, HEARTBEAT_INTERVAL_MS);
  return heartbeat;
}
