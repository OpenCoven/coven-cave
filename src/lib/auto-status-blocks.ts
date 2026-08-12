/**
 * `/auto` mission status blocks — the `<coven:auto-status …>` marker protocol
 * that makes an autonomous mission's phase visible in the chat thread and
 * lets the app decide when to interrupt the human (design mirrors
 * skill-blocks.ts's `<coven:skill>` protocol; see coven-marker-directive.ts
 * for the text taught to the model).
 *
 * States: clarifying (still needs answers), working (proceeding silently),
 * blocked (needs a human — permissions, a decision, credentials, anything the
 * familiar can't resolve itself), failed (hit something unrecoverable; the
 * mission is over either way), done (mission finished). Only blocked/failed/
 * done should draw the human's attention — that decision lives in the caller
 * (chat-view's auto-mode watcher), this module only extracts the latest
 * state per turn.
 *
 * `timed-out` also exists as a mission state, but deliberately has NO marker:
 * it is what the client concludes when the model says nothing at all, so
 * accepting it from the model would defeat the point. See auto-mission-state.ts.
 */

import { markdownCodeRanges } from "./github-blocks.ts";
import {
  type ProtectedTextRange,
  validateProtectedTextRanges,
} from "./protected-text-ranges.ts";

export type AutoMissionState = "clarifying" | "working" | "blocked" | "failed" | "done";

export type AutoStatusUpdate = {
  state: AutoMissionState;
  note?: string;
};

/**
 * Accepted spellings → canonical state. A model that writes "complete" or
 * "Done" has told us exactly what we asked for; dropping that marker on a
 * string mismatch would strand the mission with no ping, which is the single
 * worst outcome this feature has. Matching is case-insensitive and tolerant of
 * the obvious synonyms rather than silently strict.
 */
const STATE_ALIASES: ReadonlyMap<string, AutoMissionState> = new Map([
  ["clarifying", "clarifying"],
  ["clarify", "clarifying"],
  ["questions", "clarifying"],
  ["working", "working"],
  ["in-progress", "working"],
  ["in_progress", "working"],
  ["running", "working"],
  ["blocked", "blocked"],
  ["needs-human", "blocked"],
  ["needs-approval", "blocked"],
  ["waiting", "blocked"],
  ["failed", "failed"],
  ["failure", "failed"],
  ["error", "failed"],
  ["done", "done"],
  ["complete", "done"],
  ["completed", "done"],
  ["finished", "done"],
  ["success", "done"],
]);

function canonicalState(raw: string | undefined): AutoMissionState | null {
  if (!raw) return null;
  return STATE_ALIASES.get(raw.trim().toLowerCase()) ?? null;
}

const MARKER_CANDIDATE = "<coven:a";
const MARKER_NAME = "<coven:auto-status";
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

function scanAutoStatusMarkers(
  text: string,
  codeRanges: ReadonlyArray<ProtectedTextRange>,
  opaqueRanges: ReadonlyArray<ProtectedTextRange>,
): { removedRanges: Array<[number, number]>; update: AutoStatusUpdate | null } {
  const removedRanges: Array<[number, number]> = [];
  let update: AutoStatusUpdate | null = null;
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
      const state = canonicalState(attrs.state);
      if (state) {
        const next: AutoStatusUpdate = { state };
        const note = attrs.note?.trim();
        if (note) next.note = note;
        update = next;
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

  return { removedRanges, update };
}

/**
 * Extract auto-mission status markers from a turn's text. Streaming-safe:
 * complete markers are removed from `visible` (never rendered raw), and
 * incomplete marker prefixes are hidden without preventing later complete
 * markers from parsing. Keeps only the LAST state seen (in-place update
 * semantics), matching extractSkillMarkers.
 */
export function extractAutoStatusMarkers(
  text: string,
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { visible: string; update: AutoStatusUpdate | null } {
  if (markdownRangeSource.length !== text.length) {
    throw new RangeError("extractAutoStatusMarkers range source must match text length");
  }
  const opaqueRanges = validateProtectedTextRanges(
    text.length,
    protectedRanges,
    "extractAutoStatusMarkers",
  );
  if (!text || !text.includes("<coven:a")) return { visible: text, update: null };

  const codeRanges = markdownCodeRanges(markdownRangeSource);
  const { removedRanges, update } = scanAutoStatusMarkers(
    text,
    codeRanges,
    opaqueRanges,
  );

  return { visible: removeRanges(text, removedRanges), update };
}
