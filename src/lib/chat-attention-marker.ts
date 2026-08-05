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
const ATTENTION_MARKER_START = "<coven:attention";
const MARKER_RE = /<coven:attention\b((?:[^">]|"[^"]*")*?)\/?>/g;
const EXACT_REASON_ATTR_RE = /^\s*reason\s*=\s*"([^"]*)"\s*$/;

export function extractChatAttentionMarker(
  text: string,
  options: { pending?: boolean } = {},
): { visible: string; request: ChatAttentionMarker | null } {
  if (!text) return { visible: text, request: null };
  if (!text.includes("<coven:a")) {
    if (!options.pending) return { visible: text, request: null };
    const tail = trailingMarkerPrefixStart(text);
    if (
      tail === -1
      || markdownCodeRanges(text).some(([start, end]) => tail >= start && tail < end)
    ) {
      return { visible: text, request: null };
    }
    return { visible: text.slice(0, tail), request: null };
  }

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

  const pendingTail = options.pending ? trailingMarkerPrefixStart(visible) : -1;
  if (
    pendingTail !== -1
    && !markdownCodeRanges(visible).some(([start, end]) => pendingTail >= start && pendingTail < end)
  ) {
    visible = visible.slice(0, pendingTail);
  }

  const tail = visible.lastIndexOf("<coven:a");
  if (
    options.pending
    &&
    tail !== -1
    && !hasUnquotedGtAfter(visible, tail)
    && !markdownCodeRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const frag = visible.slice(tail);
    if (isPotentialAttentionMarkerFragment(frag)) {
      visible = visible.slice(0, tail);
    }
  }

  return { visible, request };
}

function trailingMarkerPrefixStart(text: string): number {
  const maxLength = Math.min(text.length, ATTENTION_MARKER_START.length);
  for (let length = maxLength; length > 0; length--) {
    if (ATTENTION_MARKER_START.startsWith(text.slice(-length))) {
      return text.length - length;
    }
  }
  return -1;
}

function isPotentialAttentionMarkerFragment(fragment: string): boolean {
  if (ATTENTION_MARKER_START.startsWith(fragment)) return true;
  if (!fragment.startsWith(ATTENTION_MARKER_START)) return false;
  return /\W/.test(fragment[ATTENTION_MARKER_START.length] ?? "");
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
