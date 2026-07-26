import type { StreamEvent } from "@/lib/stream-events";

export type ChatSseReadResult = {
  /** Last server-issued event id observed while reading this response. */
  cursor: number;
  /** Whether the stream explicitly confirmed the run had settled. */
  sawDone: boolean;
};

/**
 * Consume Cave's chat SSE framing. `id:` is deliberately surfaced so a caller
 * can reattach through `/api/chat/stream` after a WebView or network drop.
 *
 * The bridge currently emits LF frames, but accepting CRLF here matters for
 * platform WebViews and intermediaries that normalize line endings.
 */
export async function consumeChatSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent, cursor: number | null) => void,
): Promise<ChatSseReadResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = 0;
  let sawDone = false;

  const handleFrame = (frame: string) => {
    let frameCursor: number | null = null;
    const data: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith("id:")) {
        const parsed = Number(rawLine.slice(3).trim());
        if (Number.isSafeInteger(parsed) && parsed > 0) frameCursor = parsed;
      } else if (rawLine.startsWith("data:")) {
        data.push(rawLine.slice(5).trimStart());
      }
    }
    if (frameCursor != null) cursor = frameCursor;
    const payload = data.join("\n").trim();
    if (!payload) return;
    try {
      const event = JSON.parse(payload) as StreamEvent;
      if (!event || typeof event !== "object" || typeof event.kind !== "string") return;
      if (event.kind === "done") sawDone = true;
      onEvent(event, frameCursor);
    } catch {
      // A malformed frame must not discard the rest of a long-running reply.
    }
  };

  const drain = () => {
    while (true) {
      const boundary = buffer.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index == null) return;
      const end = boundary.index;
      handleFrame(buffer.slice(0, end));
      buffer = buffer.slice(end + boundary[0].length);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }
  buffer += decoder.decode();
  drain();
  if (buffer.trim()) handleFrame(buffer);
  return { cursor, sawDone };
}
