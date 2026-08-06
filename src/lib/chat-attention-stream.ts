import {
  extractChatAttentionMarker,
  extractIncompleteChatAttentionMarker,
} from "./chat-attention-marker.ts";

export type AttentionSafeTextAccumulator = {
  append(chunk: string): string;
  replace(text: string): string;
  visible(): string;
  settled(): string;
  cancelled(): string;
};

/**
 * Retains the raw stream privately so chunk boundaries can never turn a
 * partially hidden attention marker into displayed or persisted text.
 */
export function createAttentionSafeTextAccumulator(): AttentionSafeTextAccumulator {
  let rawText = "";
  const pendingText = () => extractChatAttentionMarker(rawText, { pending: true }).visible;
  const settledText = () => extractChatAttentionMarker(rawText, { pending: false }).visible;

  return {
    append(chunk) {
      rawText += chunk;
      return pendingText();
    },
    replace(text) {
      rawText = text;
      return pendingText();
    },
    visible: pendingText,
    settled: settledText,
    cancelled() {
      return extractIncompleteChatAttentionMarker(rawText).visible;
    },
  };
}
