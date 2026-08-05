import { extractChatAttentionMarker } from "./chat-attention-marker.ts";

export type AttentionSafeTextAccumulator = {
  append(chunk: string): string;
  replace(text: string): string;
  visible(): string;
  settled(): string;
};

/**
 * Retains the raw stream privately so chunk boundaries can never turn a
 * partially hidden attention marker into displayed or persisted text.
 */
export function createAttentionSafeTextAccumulator(): AttentionSafeTextAccumulator {
  let rawText = "";
  const safeText = () => extractChatAttentionMarker(rawText, { pending: true }).visible;

  return {
    append(chunk) {
      rawText += chunk;
      return safeText();
    },
    replace(text) {
      rawText = text;
      return safeText();
    },
    visible: safeText,
    settled: safeText,
  };
}
