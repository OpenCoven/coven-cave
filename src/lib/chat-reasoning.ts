import { markdownCodeRanges } from "./github-blocks.ts";
import {
  type ProtectedTextRange,
  validateProtectedTextRanges,
} from "./protected-text-ranges.ts";

type VisibleProjection = {
  text: string;
  protectedRanges: Array<[start: number, end: number]>;
};

type TextReplacement = {
  start: number;
  end: number;
  value: string;
};

function applyTextReplacements(
  projection: VisibleProjection,
  replacements: TextReplacement[],
): VisibleProjection {
  if (replacements.length === 0) return projection;

  const parts: string[] = [];
  let cursor = 0;
  for (const entry of replacements) {
    parts.push(projection.text.slice(cursor, entry.start), entry.value);
    cursor = entry.end;
  }
  parts.push(projection.text.slice(cursor));

  const mappedRanges: Array<[number, number]> = [];
  let replacementIndex = 0;
  let shift = 0;
  for (const [start, end] of projection.protectedRanges) {
    while (
      replacementIndex < replacements.length
      && replacements[replacementIndex].end <= start
    ) {
      const entry = replacements[replacementIndex];
      shift += entry.value.length - (entry.end - entry.start);
      replacementIndex += 1;
    }
    mappedRanges.push([start + shift, end + shift]);
  }

  return { text: parts.join(""), protectedRanges: mappedRanges };
}

function replaceOutsideProtectedRanges(
  projection: VisibleProjection,
  pattern: RegExp,
  replacement: string,
): VisibleProjection {
  const replacements: TextReplacement[] = [];
  let protectedRangeIndex = 0;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(projection.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    while (
      protectedRangeIndex < projection.protectedRanges.length
      && projection.protectedRanges[protectedRangeIndex][1] <= start
    ) {
      protectedRangeIndex += 1;
    }
    const protectedRange = projection.protectedRanges[protectedRangeIndex];
    if (!protectedRange || end <= protectedRange[0] || start >= protectedRange[1]) {
      replacements.push({ start, end, value: replacement });
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return applyTextReplacements(projection, replacements);
}

function removeMatchesOutsideProtectedRanges(
  projection: VisibleProjection,
  pattern: RegExp,
): VisibleProjection {
  const replacements: TextReplacement[] = [];
  let protectedRangeIndex = 0;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(projection.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    while (
      protectedRangeIndex < projection.protectedRanges.length
      && projection.protectedRanges[protectedRangeIndex][1] <= start
    ) {
      protectedRangeIndex += 1;
    }
    const containingRange = projection.protectedRanges[protectedRangeIndex];
    if (
      containingRange
      && start >= containingRange[0]
      && start < containingRange[1]
    ) {
      continue;
    }

    let cursor = start;
    let rangeIndex = protectedRangeIndex;
    while (
      rangeIndex < projection.protectedRanges.length
      && projection.protectedRanges[rangeIndex][0] < end
    ) {
      const [rangeStart, rangeEnd] = projection.protectedRanges[rangeIndex];
      if (cursor < rangeStart) {
        replacements.push({
          start: cursor,
          end: Math.min(rangeStart, end),
          value: "",
        });
      }
      cursor = Math.max(cursor, rangeEnd);
      rangeIndex += 1;
    }
    if (cursor < end) replacements.push({ start: cursor, end, value: "" });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return applyTextReplacements(projection, replacements);
}

function normalizeVisibleProjection(projection: VisibleProjection): string {
  const withoutDebugPrefixes = removeMatchesOutsideProtectedRanges(
    projection,
    /^\[[a-z][\w-]*(?:\/[\w-]+)+\][^\n]*\n?/gim,
  );
  const collapsedNewlines = replaceOutsideProtectedRanges(
    withoutDebugPrefixes,
    /\n{3,}/g,
    "\n\n",
  );
  return replaceOutsideProtectedRanges(
    collapsedNewlines,
    /^\s+/gu,
    "",
  ).text;
}

/**
 * Split assistant text into its visible body and hidden reasoning blocks.
 * Unclosed blocks stay hidden while a response is streaming.
 */
export function splitReasoning(
  text: string,
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { visible: string; reasoning: string } {
  if (markdownRangeSource.length !== text.length) {
    throw new RangeError("splitReasoning range source must match text length");
  }
  const opaqueRanges = validateProtectedTextRanges(
    text.length,
    protectedRanges,
    "splitReasoning",
  );
  const reasoningParts: string[] = [];
  const visibleParts: string[] = [];
  const visibleProtectedRanges: Array<[number, number]> = [];
  const tagRe = /<(\/?)(thinking|reasoning)>/gi;
  const codeRanges = markdownCodeRanges(markdownRangeSource);
  let codeRangeIndex = 0;
  let opaqueRangeIndex = 0;
  let activeTag: string | null = null;
  let reasoningStart = 0;
  let cursor = 0;
  let visibleLength = 0;
  let visibleOpaqueRangeIndex = 0;
  let match: RegExpExecArray | null;

  const pushVisibleSlice = (start: number, end: number) => {
    if (start >= end) return;
    while (
      visibleOpaqueRangeIndex < opaqueRanges.length
      && opaqueRanges[visibleOpaqueRangeIndex][1] <= start
    ) {
      visibleOpaqueRangeIndex += 1;
    }
    let rangeIndex = visibleOpaqueRangeIndex;
    while (rangeIndex < opaqueRanges.length) {
      const [rangeStart, rangeEnd] = opaqueRanges[rangeIndex];
      if (rangeStart >= end) break;
      const mappedStart = visibleLength + Math.max(rangeStart, start) - start;
      const mappedEnd = visibleLength + Math.min(rangeEnd, end) - start;
      const previous = visibleProtectedRanges[visibleProtectedRanges.length - 1];
      if (previous && mappedStart <= previous[1]) {
        previous[1] = Math.max(previous[1], mappedEnd);
      } else {
        visibleProtectedRanges.push([mappedStart, mappedEnd]);
      }
      if (rangeEnd > end) break;
      rangeIndex += 1;
    }
    visibleOpaqueRangeIndex = rangeIndex;
    const slice = text.slice(start, end);
    visibleParts.push(slice);
    visibleLength += slice.length;
  };

  while ((match = tagRe.exec(text)) !== null) {
    const matchIndex = match.index;
    while (
      codeRangeIndex < codeRanges.length
      && codeRanges[codeRangeIndex][1] <= matchIndex
    ) {
      codeRangeIndex += 1;
    }
    const codeRange = codeRanges[codeRangeIndex];
    while (
      opaqueRangeIndex < opaqueRanges.length
      && opaqueRanges[opaqueRangeIndex][1] <= matchIndex
    ) {
      opaqueRangeIndex += 1;
    }
    const opaqueRange = opaqueRanges[opaqueRangeIndex];
    if (
      (codeRange && matchIndex >= codeRange[0] && matchIndex < codeRange[1])
      || (opaqueRange && matchIndex >= opaqueRange[0] && matchIndex < opaqueRange[1])
    ) {
      continue;
    }
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (!activeTag && closing) {
      pushVisibleSlice(cursor, match.index);
      cursor = tagRe.lastIndex;
      continue;
    }

    if (!activeTag && !closing) {
      pushVisibleSlice(cursor, match.index);
      activeTag = tag;
      reasoningStart = tagRe.lastIndex;
      cursor = tagRe.lastIndex;
      continue;
    }

    if (activeTag === tag && closing) {
      reasoningParts.push(text.slice(reasoningStart, match.index).trim());
      activeTag = null;
      cursor = tagRe.lastIndex;
    }
  }

  if (activeTag) {
    reasoningParts.push(text.slice(reasoningStart).trim());
  } else {
    pushVisibleSlice(cursor, text.length);
  }

  const visible = visibleParts.join("");
  return {
    visible: normalizeVisibleProjection({
      text: visible,
      protectedRanges: visibleProtectedRanges,
    }),
    reasoning: reasoningParts.join("\n\n").trim(),
  };
}
