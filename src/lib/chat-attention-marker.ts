import { markdownCodeRanges } from "./github-blocks.ts";

export const CHAT_ATTENTION_REASONS = [
  "input",
  "approval",
  "credentials",
  "decision",
] as const;

export type ChatAttentionReason = (typeof CHAT_ATTENTION_REASONS)[number];

export type ChatAttentionMarker = {
  reason: ChatAttentionReason;
};

const ATTENTION_REASON_SET = new Set<string>(CHAT_ATTENTION_REASONS);
const MARKER_RE = /<coven:attention\b((?:[^">]|"[^"]*")*?)\/?>/g;
const EXACT_REASON_ATTR_RE = /^\s*reason\s*=\s*"([^"]*)"\s*$/;

export function extractChatAttentionMarker(
  text: string,
): { visible: string; request: ChatAttentionMarker | null } {
  if (!text || !text.includes("<coven:a")) return { visible: text, request: null };

  const codeRanges = markdownCodeRanges(text);
  let request: ChatAttentionMarker | null = null;

  let visible = text.replace(MARKER_RE, (marker, rawAttrs: string, index: number) => {
    if (codeRanges.some(([start, end]) => index >= start && index < end)) return marker;
    const reason = parseAttentionReason(marker, rawAttrs ?? "");
    if (reason && ATTENTION_REASON_SET.has(reason)) {
      request = { reason: reason as ChatAttentionReason };
    }
    return "";
  });

  const tail = visible.lastIndexOf("<coven:a");
  if (
    tail !== -1
    && !hasUnquotedGtAfter(visible, tail)
    && !markdownCodeRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const frag = visible.slice(tail);
    if ("<coven:attention".startsWith(frag.slice(0, "<coven:attention".length))) {
      visible = visible.slice(0, tail);
    }
  }

  return { visible, request };
}

function parseAttentionReason(marker: string, rawAttrs: string): string | null {
  if (!marker.endsWith("/>")) return null;
  return EXACT_REASON_ATTR_RE.exec(rawAttrs)?.[1] ?? null;
}

function hasUnquotedGtAfter(text: string, from: number): boolean {
  let inQuote = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ">" && !inQuote) return true;
  }
  return false;
}
