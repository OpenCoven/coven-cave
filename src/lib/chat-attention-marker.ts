import { markdownCodeRanges } from "./github-blocks.ts";
import {
  indexInProtectedTextRanges,
  type ProtectedTextRange,
  validateProtectedTextRanges,
} from "./protected-text-ranges.ts";

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

export type ChatAttentionMarkerOptions = {
  pending?: boolean;
};

type AttentionProjection = {
  text: string;
  markdownRangeSource: string;
  protectedRanges: ProtectedTextRange[];
};

function rangesIntersect(
  ranges: ReadonlyArray<ProtectedTextRange>,
  start: number,
  end: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [rangeStart, rangeEnd] = ranges[middle];
    if (rangeEnd <= start) {
      low = middle + 1;
    } else if (rangeStart >= end) {
      high = middle - 1;
    } else {
      return true;
    }
  }
  return false;
}

function removeProjectionRanges(
  projection: AttentionProjection,
  ranges: ReadonlyArray<ProtectedTextRange>,
): AttentionProjection {
  if (ranges.length === 0) return projection;

  const textParts: string[] = [];
  const rangeSourceParts: string[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    textParts.push(projection.text.slice(cursor, start));
    rangeSourceParts.push(projection.markdownRangeSource.slice(cursor, start));
    cursor = end;
  }
  textParts.push(projection.text.slice(cursor));
  rangeSourceParts.push(projection.markdownRangeSource.slice(cursor));

  const mappedProtectedRanges: ProtectedTextRange[] = [];
  let removedIndex = 0;
  let shift = 0;
  for (const [start, end] of projection.protectedRanges) {
    while (removedIndex < ranges.length && ranges[removedIndex][1] <= start) {
      const removed = ranges[removedIndex];
      shift += removed[1] - removed[0];
      removedIndex += 1;
    }
    mappedProtectedRanges.push([start - shift, end - shift]);
  }

  return {
    text: textParts.join(""),
    markdownRangeSource: rangeSourceParts.join(""),
    protectedRanges: mappedProtectedRanges,
  };
}

function markerStartIsProtected(
  index: number,
  codeRanges: ReadonlyArray<ProtectedTextRange>,
  opaqueRanges: ReadonlyArray<ProtectedTextRange>,
): boolean {
  return (
    indexInProtectedTextRanges(codeRanges, index)
    || indexInProtectedTextRanges(opaqueRanges, index)
  );
}

function normalizeAttentionProjection(
  text: string,
  markdownRangeSource: string,
  protectedRanges: ReadonlyArray<ProtectedTextRange>,
  caller: string,
): AttentionProjection {
  if (markdownRangeSource.length !== text.length) {
    throw new RangeError(`${caller} range source must match text length`);
  }
  return {
    text,
    markdownRangeSource,
    protectedRanges: validateProtectedTextRanges(
      text.length,
      protectedRanges,
      caller,
    ),
  };
}

function extractChatAttentionMarkerProjection(
  text: string,
  options: ChatAttentionMarkerOptions,
  markdownRangeSource: string,
  protectedRanges: ReadonlyArray<ProtectedTextRange>,
  caller: string,
): {
  projection: AttentionProjection;
  request: ChatAttentionMarker | null;
} {
  let projection = normalizeAttentionProjection(
    text,
    markdownRangeSource,
    protectedRanges,
    caller,
  );
  if (!text) return { projection, request: null };
  if (!text.includes("<coven:a")) {
    if (!options.pending) return { projection, request: null };
    const tail = trailingMarkerPrefixStart(text);
    const codeRanges = markdownCodeRanges(projection.markdownRangeSource);
    if (
      tail === -1
      || markerStartIsProtected(tail, codeRanges, projection.protectedRanges)
    ) {
      return { projection, request: null };
    }
    return {
      projection: removeProjectionRanges(projection, [[tail, text.length]]),
      request: null,
    };
  }

  const codeRanges = markdownCodeRanges(projection.markdownRangeSource);
  const removedRanges: ProtectedTextRange[] = [];
  let request: ChatAttentionMarker | null = null;
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(projection.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      markerStartIsProtected(start, codeRanges, projection.protectedRanges)
      || rangesIntersect(projection.protectedRanges, start, end)
    ) {
      continue;
    }
    const reason = parseAttentionReason(match[0], match[1] ?? "");
    if (reason && ATTENTION_REASON_SET.has(reason)) {
      request = { reason: reason as ChatAttentionReason };
    }
    removedRanges.push([start, end]);
  }
  projection = removeProjectionRanges(projection, removedRanges);
  projection = stripMalformedCompleteAttentionMarkers(
    projection,
    Boolean(options.pending),
  );

  if (options.pending) {
    let pendingTail = trailingMarkerPrefixStart(projection.text);
    let currentCodeRanges = markdownCodeRanges(projection.markdownRangeSource);
    if (
      pendingTail !== -1
      && !markerStartIsProtected(
        pendingTail,
        currentCodeRanges,
        projection.protectedRanges,
      )
    ) {
      projection = removeProjectionRanges(
        projection,
        [[pendingTail, projection.text.length]],
      );
    }

    const tail = projection.text.lastIndexOf("<coven:a");
    currentCodeRanges = markdownCodeRanges(projection.markdownRangeSource);
    if (
      tail !== -1
      && !hasUnquotedGtAfter(projection.text, tail)
      && !markerStartIsProtected(tail, currentCodeRanges, projection.protectedRanges)
      && isPotentialAttentionMarkerFragment(projection.text.slice(tail))
    ) {
      projection = removeProjectionRanges(
        projection,
        [[tail, projection.text.length]],
      );
    }
  }

  return { projection, request };
}

export function extractChatAttentionMarker(
  text: string,
  options: ChatAttentionMarkerOptions = {},
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { visible: string; request: ChatAttentionMarker | null } {
  const { projection, request } = extractChatAttentionMarkerProjection(
    text,
    options,
    markdownRangeSource,
    protectedRanges,
    "extractChatAttentionMarker",
  );
  return { visible: projection.text, request };
}

export function extractIncompleteChatAttentionMarker(
  text: string,
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { visible: string; request: ChatAttentionMarker | null } {
  const settled = extractChatAttentionMarkerProjection(
    text,
    {},
    markdownRangeSource,
    protectedRanges,
    "extractIncompleteChatAttentionMarker",
  );
  return {
    visible: stripIncompleteMarkerTail(settled.projection).text,
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

function stripIncompleteMarkerTail(
  initialProjection: AttentionProjection,
): AttentionProjection {
  let projection = initialProjection;
  let codeRanges = markdownCodeRanges(projection.markdownRangeSource);
  const pendingTail = trailingMarkerPrefixStart(projection.text);
  if (
    pendingTail !== -1
    && projection.text.length - pendingTail > 1
    && !markerStartIsProtected(
      pendingTail,
      codeRanges,
      projection.protectedRanges,
    )
  ) {
    projection = removeProjectionRanges(
      projection,
      [[pendingTail, projection.text.length]],
    );
  }

  const tail = projection.text.lastIndexOf("<coven:a");
  codeRanges = markdownCodeRanges(projection.markdownRangeSource);
  if (
    tail !== -1
    && !hasUnquotedGtAfter(projection.text, tail)
    && !markerStartIsProtected(tail, codeRanges, projection.protectedRanges)
  ) {
    const frag = projection.text.slice(tail);
    if (isPotentialAttentionMarkerFragment(frag)) {
      projection = removeProjectionRanges(
        projection,
        [[tail, projection.text.length]],
      );
    }
  }
  return projection;
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

function stripMalformedCompleteAttentionMarkers(
  projection: AttentionProjection,
  pending: boolean,
): AttentionProjection {
  if (!projection.text.includes(ATTENTION_MARKER_START)) return projection;
  const codeRanges = markdownCodeRanges(projection.markdownRangeSource);
  const removedRanges: ProtectedTextRange[] = [];
  let start = projection.text.indexOf(ATTENTION_MARKER_START);

  while (start !== -1) {
    if (markerStartIsProtected(start, codeRanges, projection.protectedRanges)) {
      start = projection.text.indexOf(
        ATTENTION_MARKER_START,
        start + ATTENTION_MARKER_START.length,
      );
      continue;
    }
    const boundary = projection.text[start + ATTENTION_MARKER_START.length] ?? "";
    if (boundary && /[A-Za-z0-9:_-]/.test(boundary)) {
      start = projection.text.indexOf(
        ATTENTION_MARKER_START,
        start + ATTENTION_MARKER_START.length,
      );
      continue;
    }

    const lineEnd = projection.text.indexOf("\n", start);
    const rawEnd = projection.text.indexOf(
      ">",
      start + ATTENTION_MARKER_START.length,
    );
    if (rawEnd === -1 || (lineEnd !== -1 && rawEnd > lineEnd)) {
      start = projection.text.indexOf(
        ATTENTION_MARKER_START,
        start + ATTENTION_MARKER_START.length,
      );
      continue;
    }
    const end = rawEnd + 1;
    if (
      rangesIntersect(codeRanges, start, end)
      || rangesIntersect(projection.protectedRanges, start, end)
    ) {
      start = projection.text.indexOf(
        ATTENTION_MARKER_START,
        start + ATTENTION_MARKER_START.length,
      );
      continue;
    }

    const fragment = projection.text.slice(start);
    if (pending && isPotentialAttentionMarkerFragment(fragment)) {
      start = projection.text.indexOf(
        ATTENTION_MARKER_START,
        start + ATTENTION_MARKER_START.length,
      );
      continue;
    }
    removedRanges.push([start, end]);
    start = projection.text.indexOf(ATTENTION_MARKER_START, end);
  }

  return removeProjectionRanges(projection, removedRanges);
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
