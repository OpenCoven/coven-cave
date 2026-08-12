/**
 * Skill stage blocks — the `<coven:skill …>` marker protocol that makes skill
 * invocations visible in the chat thread (design:
 * docs/chat-github-integration.md §5; bead cave-fpqx.11).
 *
 * Two producers, one card:
 *   1. Agents emit markers as a skill loads/progresses/finishes:
 *        <coven:skill name="brainstorming" stage="running" note="asking q3" />
 *      Repeated markers for the same name UPDATE the turn's card in place —
 *      extraction keeps the LAST stage per name.
 *   2. The `/skill` directive is deterministic: the app built the invocation
 *      prompt itself (buildSkillPrompt), so parseSkillInvocation recovers the
 *      skill name from the user turn with no harness cooperation.
 *
 * Pure and JSX-free (node --test); the card lives in
 * src/components/skill-stage-card.tsx.
 */

import { markdownCodeRanges } from "./github-blocks.ts";
import {
  type ProtectedTextRange,
  validateProtectedTextRanges,
} from "./protected-text-ranges.ts";

export type SkillStage = "loaded" | "running" | "done" | "error";

export type SkillStageUpdate = {
  name: string;
  stage: SkillStage;
  note?: string;
};

const STAGES: ReadonlySet<string> = new Set(["loaded", "running", "done", "error"]);

const MARKER_CANDIDATE = "<coven:s";
const MARKER_NAME = "<coven:skill";
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

function removeRanges(text: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(cursor, start));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function isNameContinuation(character: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(character);
}

function scanSkillMarkers(
  text: string,
  codeRanges: ReadonlyArray<ProtectedTextRange>,
  opaqueRanges: ReadonlyArray<ProtectedTextRange>,
  byName: Map<string, SkillStageUpdate>,
): Array<[number, number]> {
  const removedRanges: Array<[number, number]> = [];
  let cursor = 0;
  let codeRangeIndex = 0;
  let opaqueRangeIndex = 0;

  while (cursor < text.length) {
    const start = text.indexOf(MARKER_CANDIDATE, cursor);
    if (start === -1) break;

    while (
      codeRangeIndex < codeRanges.length
      && codeRanges[codeRangeIndex][1] <= start
    ) {
      codeRangeIndex += 1;
    }
    while (
      opaqueRangeIndex < opaqueRanges.length
      && opaqueRanges[opaqueRangeIndex][1] <= start
    ) {
      opaqueRangeIndex += 1;
    }

    const codeRange = codeRanges[codeRangeIndex];
    const opaqueRange = opaqueRanges[opaqueRangeIndex];
    let containingRangeEnd = 0;
    if (codeRange && start >= codeRange[0] && start < codeRange[1]) {
      containingRangeEnd = codeRange[1];
    }
    if (opaqueRange && start >= opaqueRange[0] && start < opaqueRange[1]) {
      containingRangeEnd = Math.max(containingRangeEnd, opaqueRange[1]);
    }
    if (containingRangeEnd > 0) {
      cursor = containingRangeEnd;
      continue;
    }

    let nameOffset = MARKER_CANDIDATE.length;
    while (
      nameOffset < MARKER_NAME.length
      && start + nameOffset < text.length
      && text[start + nameOffset] === MARKER_NAME[nameOffset]
    ) {
      nameOffset += 1;
    }
    if (nameOffset < MARKER_NAME.length) {
      const end = start + nameOffset;
      if (end === text.length) {
        removedRanges.push([start, end]);
        break;
      }
      if (!isNameContinuation(text[end])) removedRanges.push([start, end]);
      cursor = Math.max(end, start + MARKER_CANDIDATE.length);
      continue;
    }

    const contentStart = start + MARKER_NAME.length;
    if (
      contentStart < text.length
      && /[A-Za-z0-9_]/.test(text[contentStart])
    ) {
      cursor = contentStart;
      continue;
    }

    let limit = text.length;
    if (opaqueRange && opaqueRange[0] > start) {
      limit = Math.min(limit, opaqueRange[0]);
    }
    const codeBoundary = codeRange && codeRange[0] > start
      ? codeRange[0]
      : null;

    let inQuote = false;
    let codeBoundaryFallback: number | null = null;
    let nestedCandidate: number | null = null;
    let unquotedNestedCandidate: number | null = null;
    let closeIndex: number | null = null;
    for (let index = contentStart; index < limit; index += 1) {
      if (index === codeBoundary) {
        codeBoundaryFallback = index;
        if (!inQuote) break;
      }
      if (text.startsWith(MARKER_CANDIDATE, index)) {
        nestedCandidate ??= index;
        if (!inQuote) {
          unquotedNestedCandidate = index;
          break;
        }
      }
      const character = text[index];
      if (character === '"') {
        inQuote = !inQuote;
      } else if (character === ">" && !inQuote) {
        closeIndex = index;
        break;
      }
    }

    if (closeIndex !== null) {
      const attrs = parseAttrs(text.slice(contentStart, closeIndex));
      const name = attrs.name?.trim();
      const stage = attrs.stage?.trim();
      if (name && stage && STAGES.has(stage)) {
        const update: SkillStageUpdate = { name, stage: stage as SkillStage };
        const note = attrs.note?.trim();
        if (note) update.note = note;
        byName.set(name, update);
      }
      removedRanges.push([start, closeIndex + 1]);
      cursor = closeIndex + 1;
      continue;
    }

    const end = Math.min(
      unquotedNestedCandidate ?? limit,
      nestedCandidate ?? limit,
      codeBoundaryFallback ?? limit,
    );
    if (end > start) removedRanges.push([start, end]);
    cursor = Math.max(end, start + MARKER_CANDIDATE.length);
  }

  return removedRanges;
}

/**
 * Extract skill markers from a turn's text. Streaming-safe: complete markers
 * are removed from `visible` (never rendered raw), and incomplete marker
 * prefixes are hidden without preventing later complete markers from parsing.
 * Updates keep the last stage per skill name (in-place update semantics), in
 * first-seen name order.
 */
export function extractSkillMarkers(
  text: string,
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { visible: string; updates: SkillStageUpdate[] } {
  if (markdownRangeSource.length !== text.length) {
    throw new RangeError("extractSkillMarkers range source must match text length");
  }
  const opaqueRanges = validateProtectedTextRanges(
    text.length,
    protectedRanges,
    "extractSkillMarkers",
  );
  if (!text || !text.includes("<coven:s")) return { visible: text, updates: [] };

  const byName = new Map<string, SkillStageUpdate>();
  const codeRanges = markdownCodeRanges(markdownRangeSource);
  const removedRanges = scanSkillMarkers(text, codeRanges, opaqueRanges, byName);

  return {
    visible: removeRanges(text, removedRanges),
    updates: [...byName.values()],
  };
}

// buildSkillPrompt (src/lib/slash-skill.ts) shapes — anchored so ordinary
// prose starting with "Use the" doesn't false-positive.
const INVOCATION_RE = /^Use the "([^"\n]+)" skill(?:\.$|( with: )([\s\S]+)$)/;

/**
 * Deterministic `/skill` detection: recover the invocation the app itself
 * sent (buildSkillPrompt). Returns null for anything else.
 */
export function parseSkillInvocation(text: string): { name: string; args?: string } | null {
  const m = INVOCATION_RE.exec(text.trim());
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const args = m[3]?.trim();
  return args ? { name, args } : { name };
}
