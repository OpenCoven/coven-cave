import {
  extractChatAttentionMarker,
  extractIncompleteChatAttentionMarker,
} from "./chat-attention-marker.ts";
import {
  hasChatResultProtocolCandidate,
  scanChatResultProtocol,
  type ChatResultProtocolScan,
  type ChatResultProtocolScanner,
} from "./chat-result-markers.ts";
import type { ProtectedTextRange } from "./protected-text-ranges.ts";

export type AttentionSafeTextAccumulator = {
  append(
    chunk: string,
    markdownRangeSource?: string,
    protectedRanges?: ReadonlyArray<ProtectedTextRange>,
  ): string;
  replace(
    text: string,
    markdownRangeSource?: string,
    protectedRanges?: ReadonlyArray<ProtectedTextRange>,
  ): string;
  visible(): string;
  settled(): string;
  terminal(): string;
  cancelled(): string;
};

/**
 * Retains the raw stream privately so chunk boundaries can never turn a
 * partially hidden attention marker into displayed or persisted text. Optional
 * range inputs describe the full raw text after the append or replacement;
 * when omitted, result opacity is derived lazily only for attention candidates.
 */
export function createAttentionSafeTextAccumulator(
  scanResultProtocol: ChatResultProtocolScanner = scanChatResultProtocol,
): AttentionSafeTextAccumulator {
  let rawText = "";
  let suppliedRangeSource: string | undefined;
  let suppliedProtectedRanges: ReadonlyArray<ProtectedTextRange> | undefined;
  let derivedResultScan: ChatResultProtocolScan | undefined;
  const updateRanges = (
    rangeSource: string | undefined,
    ranges: ReadonlyArray<ProtectedTextRange> | undefined,
  ) => {
    suppliedRangeSource = rangeSource;
    suppliedProtectedRanges = ranges;
    derivedResultScan = undefined;
  };
  const hasTrailingAttentionPrefix = () => {
    const markerStart = "<coven:attention";
    const maxLength = Math.min(rawText.length, markerStart.length);
    for (let length = maxLength; length > 0; length -= 1) {
      if (markerStart.startsWith(rawText.slice(-length))) return true;
    }
    return false;
  };
  const hasAttentionCandidate = (includeIncomplete: boolean) =>
    rawText.includes("<coven:attention")
    || (includeIncomplete && hasTrailingAttentionPrefix());
  const rangeInputs = () => {
    if (
      suppliedRangeSource !== undefined
      || suppliedProtectedRanges !== undefined
    ) {
      return {
        markdownRangeSource: suppliedRangeSource ?? rawText,
        protectedRanges: suppliedProtectedRanges ?? [],
      };
    }
    if (hasChatResultProtocolCandidate(rawText)) {
      if (!derivedResultScan) {
        const nextScan = scanResultProtocol(rawText);
        if (
          nextScan.sourceText !== rawText
          || nextScan.sourceLength !== rawText.length
          || nextScan.markdownRangeSource.length !== rawText.length
        ) {
          throw new RangeError(
            "attention result scan must match the exact current source",
          );
        }
        derivedResultScan = nextScan;
      }
      return {
        markdownRangeSource: derivedResultScan.markdownRangeSource,
        protectedRanges: derivedResultScan.protectedRanges,
      };
    }
    return { markdownRangeSource: rawText, protectedRanges: [] };
  };
  const pendingText = () => {
    if (!hasAttentionCandidate(true)) return rawText;
    const inputs = rangeInputs();
    return extractChatAttentionMarker(
      rawText,
      { pending: true },
      inputs.markdownRangeSource,
      inputs.protectedRanges,
    ).visible;
  };
  const settledText = () => {
    if (!hasAttentionCandidate(false)) return rawText;
    const inputs = rangeInputs();
    return extractChatAttentionMarker(
      rawText,
      { pending: false },
      inputs.markdownRangeSource,
      inputs.protectedRanges,
    ).visible;
  };
  const terminalText = () => {
    if (!hasAttentionCandidate(true)) return rawText;
    const inputs = rangeInputs();
    return extractIncompleteChatAttentionMarker(
      rawText,
      inputs.markdownRangeSource,
      inputs.protectedRanges,
    ).visible;
  };

  return {
    append(chunk, rangeSource, ranges) {
      rawText += chunk;
      updateRanges(rangeSource, ranges);
      return pendingText();
    },
    replace(text, rangeSource, ranges) {
      rawText = text;
      updateRanges(rangeSource, ranges);
      return pendingText();
    },
    visible: pendingText,
    settled: settledText,
    terminal: terminalText,
    cancelled: terminalText,
  };
}
