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
  visible = stripMalformedCompleteAttentionMarkers(visible, Boolean(options.pending));

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

export function extractIncompleteChatAttentionMarker(
  text: string,
): { visible: string; request: ChatAttentionMarker | null } {
  const settled = extractChatAttentionMarker(text);
  return {
    visible: stripIncompleteMarkerTail(settled.visible),
    request: settled.request,
  };
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

function stripIncompleteMarkerTail(text: string): string {
  let visible = text;
  const codeRanges = markdownCodeRanges(visible);
  const pendingTail = trailingMarkerPrefixStart(visible);
  if (
    pendingTail !== -1
    && visible.length - pendingTail > 1
    && !codeRanges.some(([start, end]) => pendingTail >= start && pendingTail < end)
  ) {
    visible = visible.slice(0, pendingTail);
  }

  const tail = visible.lastIndexOf("<coven:a");
  if (
    tail !== -1
    && !hasUnquotedGtAfter(visible, tail)
    && !markdownCodeRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const frag = visible.slice(tail);
    if (isPotentialAttentionMarkerFragment(frag)) {
      visible = visible.slice(0, tail);
    }
  }
  return visible;
}

function isPotentialAttentionMarkerFragment(fragment: string): boolean {
  if (ATTENTION_MARKER_START.startsWith(fragment)) return true;
  if (!fragment.startsWith(ATTENTION_MARKER_START)) return false;
  let cursor = ATTENTION_MARKER_START.length;
  if (cursor === fragment.length) return true;
  if (!/\s|\//.test(fragment[cursor])) return false;

  while (cursor < fragment.length) {
    while (cursor < fragment.length && /\s/.test(fragment[cursor])) cursor += 1;
    if (cursor === fragment.length) return true;
    if (fragment[cursor] === "/") {
      cursor += 1;
      while (cursor < fragment.length && /\s/.test(fragment[cursor])) cursor += 1;
      return cursor === fragment.length;
    }

    if (!/[A-Za-z_:]/.test(fragment[cursor])) return false;
    cursor += 1;
    while (cursor < fragment.length && /[A-Za-z0-9:._-]/.test(fragment[cursor])) cursor += 1;
    while (cursor < fragment.length && /\s/.test(fragment[cursor])) cursor += 1;
    if (cursor === fragment.length) return true;
    if (fragment[cursor] !== "=") return false;
    cursor += 1;
    while (cursor < fragment.length && /\s/.test(fragment[cursor])) cursor += 1;
    if (cursor === fragment.length) return true;
    if (fragment[cursor] !== '"') return false;
    cursor += 1;
    const closeQuote = fragment.indexOf('"', cursor);
    if (closeQuote === -1) return true;
    cursor = closeQuote + 1;
    if (cursor < fragment.length && !/\s|\//.test(fragment[cursor])) return false;
  }
  return true;
}

function stripMalformedCompleteAttentionMarkers(text: string, pending: boolean): string {
  if (!text.includes(ATTENTION_MARKER_START)) return text;
  const codeRanges = markdownCodeRanges(text);
  let out = "";
  let cursor = 0;
  let start = text.indexOf(ATTENTION_MARKER_START);

  while (start !== -1) {
    if (codeRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd)) {
      start = text.indexOf(ATTENTION_MARKER_START, start + ATTENTION_MARKER_START.length);
      continue;
    }
    const boundary = text[start + ATTENTION_MARKER_START.length] ?? "";
    if (boundary && /[A-Za-z0-9:_-]/.test(boundary)) {
      start = text.indexOf(ATTENTION_MARKER_START, start + ATTENTION_MARKER_START.length);
      continue;
    }

    const lineEnd = text.indexOf("\n", start);
    const rawEnd = text.indexOf(">", start + ATTENTION_MARKER_START.length);
    if (rawEnd === -1 || (lineEnd !== -1 && rawEnd > lineEnd)) {
      start = text.indexOf(ATTENTION_MARKER_START, start + ATTENTION_MARKER_START.length);
      continue;
    }
    const protectedRange = codeRanges.find(([rangeStart]) => rangeStart > start && rangeStart < rawEnd);
    if (protectedRange) {
      start = text.indexOf(ATTENTION_MARKER_START, protectedRange[1]);
      continue;
    }

    const fragment = text.slice(start);
    if (pending && isPotentialAttentionMarkerFragment(fragment)) {
      start = text.indexOf(ATTENTION_MARKER_START, start + ATTENTION_MARKER_START.length);
      continue;
    }
    out += text.slice(cursor, start);
    cursor = rawEnd + 1;
    start = text.indexOf(ATTENTION_MARKER_START, cursor);
  }

  return out + text.slice(cursor);
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
