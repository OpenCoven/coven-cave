/**
 * Proposal-review receipt blocks — the `<coven:proposal-review … />` marker
 * that lets a chat turn carry a reviewer's verdict on a proposed action as
 * EVIDENCE (issue #5520). The card renders what the reviewer answered and how
 * confident it was; it grants nothing. A model's self-reported confidence is
 * not an application-verifiable admission condition (AGENTS.md), so there are
 * no approve/deny affordances anywhere on this path.
 *
 * Marker shape (self-closing, attribute values quote-atomic):
 *
 *   <coven:proposal-review tool="propose_patch" target="src/x.ts"
 *     verdict="proposal_only" reviewer="jev-1.13.0"
 *     q="addresses_task:yes:0.93|evidence_supports:yes:0.91" reason="…" />
 *
 * `verdict` ∈ permit | proposal_only | reject | unavailable (anything else
 * renders as `unavailable`). `q` holds 1–6 `id:answer:confidence` triples.
 * Streaming-safe like skill-blocks.ts / auto-status-blocks.ts: fenced markers
 * stay literal example text, a partial marker at the tail hides until the
 * stream completes it, and malformed markers are dropped rather than shown raw.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

export type ProposalReviewVerdict = "permit" | "proposal_only" | "reject" | "unavailable";

export type ProposalReviewAnswer = {
  /** Reviewer question id, e.g. `addresses_task`. */
  id: string;
  /** The reviewer's answer text, e.g. `yes`. */
  answer: string;
  /** Confidence in [0, 1], or null when the triple carried none. */
  confidence: number | null;
};

export type ProposalReview = {
  tool: string;
  target: string | null;
  verdict: ProposalReviewVerdict;
  reviewer: string | null;
  answers: ProposalReviewAnswer[];
  reason: string | null;
};

export type ProposalReviewPiece =
  | { kind: "text"; text: string }
  | { kind: "proposal-review"; review: ProposalReview };

export const MAX_PROPOSAL_REVIEW_ANSWERS = 6;

const MARKER_NAME = "proposal-review";
const OPENER = `<coven:${MARKER_NAME}`;
const VERDICTS: ReadonlySet<ProposalReviewVerdict> = new Set([
  "permit",
  "proposal_only",
  "reject",
  "unavailable",
]);

// A new protocol opener always belongs to its own marker, even after a broken
// quote (same guard as approve-blocks.ts). The marker is self-closing by
// contract: a bare `>` never completes a receipt, so an ordinary opening tag
// that happens to carry tool/q attributes is malformed and dropped.
const MARKER_RE = /<coven:proposal-review\b((?:\s+[a-zA-Z-]+="(?:(?!<\/?coven:)[^"])*")*)\s*\/>/y;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;
const ANSWER_ID_RE = /^[a-z][a-z0-9_-]*$/i;

export function normalizeProposalReviewVerdict(raw: string | undefined): ProposalReviewVerdict {
  const value = raw?.trim().toLowerCase().replace(/-/g, "_") ?? "";
  return VERDICTS.has(value as ProposalReviewVerdict) ? (value as ProposalReviewVerdict) : "unavailable";
}

/** Parse `id:answer:confidence|…` into at most six well-formed answers. */
export function parseProposalReviewAnswers(raw: string | undefined): ProposalReviewAnswer[] {
  const out: ProposalReviewAnswer[] = [];
  for (const entry of (raw ?? "").split("|")) {
    if (out.length >= MAX_PROPOSAL_REVIEW_ANSWERS) break;
    const parts = entry.split(":").map((part) => part.trim());
    const [id, answer, confidenceRaw] = parts;
    if (!id || !ANSWER_ID_RE.test(id) || !answer) continue;
    let confidence: number | null = null;
    if (confidenceRaw !== undefined && confidenceRaw !== "") {
      const value = Number(confidenceRaw);
      if (!Number.isFinite(value) || value < 0 || value > 1) continue;
      confidence = value;
    }
    out.push({ id, answer, confidence });
  }
  return out;
}

function parseReview(rawAttrs: string): ProposalReview | null {
  const attrs = new Map<string, string>();
  for (const match of rawAttrs.matchAll(ATTR_RE)) {
    if (attrs.has(match[1])) return null;
    attrs.set(match[1], match[2]);
  }
  const tool = attrs.get("tool")?.trim() ?? "";
  const answers = parseProposalReviewAnswers(attrs.get("q"));
  if (!tool || answers.length === 0) return null;
  const target = attrs.get("target")?.trim() || null;
  const reviewer = attrs.get("reviewer")?.trim() || null;
  const reason = attrs.get("reason")?.trim() || null;
  return {
    tool,
    target,
    verdict: normalizeProposalReviewVerdict(attrs.get("verdict")),
    reviewer,
    answers,
    reason,
  };
}

type Candidate = { start: number; end: number; review: ProposalReview | null };

function unquotedGtAfter(text: string, from: number): number {
  let inQuote = false;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') inQuote = !inQuote;
    else if (char === ">" && !inQuote) return index;
    else if (!inQuote && index > from && text.startsWith("<coven:", index)) return -1;
  }
  return -1;
}

/**
 * Scan first, then mask marker contents before finding Markdown code ranges,
 * so backticks inside attributes can't open a code span that hides later
 * cards (mirrors approve-blocks.ts).
 */
function scanMarkers(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(OPENER, from);
    if (start === -1) break;
    MARKER_RE.lastIndex = start;
    const match = MARKER_RE.exec(text);
    if (match) {
      candidates.push({ start, end: start + match[0].length, review: parseReview(match[1]) });
      from = start + match[0].length;
      continue;
    }
    const gt = unquotedGtAfter(text, start);
    // A terminated but unparseable marker is dropped silently; an unterminated
    // one is the streaming tail and hides until the stream completes it.
    const end = gt === -1 ? text.length : gt + 1;
    candidates.push({ start, end, review: null });
    from = end;
  }
  if (candidates.length === 0) return [];

  let masked = "";
  let cursor = 0;
  for (const marker of candidates) {
    masked += text.slice(cursor, marker.start);
    masked += text.slice(marker.start, marker.end).replace(/[^\r\n]/g, " ");
    cursor = marker.end;
  }
  const ranges = markdownCodeRanges(masked + text.slice(cursor));
  return candidates.filter(({ start }) => !ranges.some(([from, to]) => start >= from && start < to));
}

/** Split a turn's text into prose and proposal-review pieces. */
export function sliceProposalReviewBlocks(text: string): ProposalReviewPiece[] {
  if (!text || !text.includes(OPENER)) return text ? [{ kind: "text", text }] : [];
  const markers = scanMarkers(text);
  const pieces: ProposalReviewPiece[] = [];
  let cursor = 0;
  const pushText = (chunk: string) => {
    if (chunk) pieces.push({ kind: "text", text: chunk });
  };
  for (const marker of markers) {
    pushText(text.slice(cursor, marker.start));
    cursor = marker.end;
    if (marker.review) pieces.push({ kind: "proposal-review", review: marker.review });
  }
  pushText(text.slice(cursor));
  return pieces;
}

/**
 * Prose-only projection for the streaming path: complete markers are removed
 * (the settled renderer turns them into cards from `cardText`) and an
 * unterminated tail is hidden so `<coven:proposal-review tool="…` never
 * renders as response text while the stream is still writing it.
 */
export function stripProposalReviewMarkers(text: string): string {
  if (!text || !text.includes("<coven:p")) return text;
  // A tail shorter than the full opener (`<coven:proposal`) has no complete
  // marker to scan yet, but it is still an unterminated marker and must not
  // flash as prose while the stream writes the rest of it.
  const markers = text.includes(OPENER) ? scanMarkers(text) : [];
  let out = "";
  let cursor = 0;
  for (const marker of markers) {
    out += text.slice(cursor, marker.start);
    cursor = marker.end;
  }
  return stripIncompleteProposalReviewMarker(out + text.slice(cursor));
}

/** Remove only an unterminated marker tail, preserving complete markers for
 *  callers that still turn them into cards (mirrors stripIncompletePreviewMarker).
 *  The tail is the last proposal-shaped `<coven:p…` fragment, not merely the
 *  last `<coven:p…`: a complete sibling `<coven:preview …/>` after it must not
 *  shield it, or card text would show what visible prose already hides. */
export function stripIncompleteProposalReviewMarker(text: string): string {
  if (!text || !text.includes("<coven:p")) return text;
  for (let tail = text.lastIndexOf("<coven:p"); tail !== -1; tail = text.lastIndexOf("<coven:p", tail - 1)) {
    const next = text.indexOf("<coven:", tail + 1);
    const nameEnd = tail + text.slice(tail + 1).search(/[\s/><]|$/) + 1;
    const name = text.slice(tail, nameEnd);
    if (!OPENER.startsWith(name)) continue;
    // A strict prefix is a fragment only where the stream (or the next marker) cut it off.
    if (name !== OPENER && nameEnd !== text.length && nameEnd !== next) continue;
    if (unquotedGtAfter(text, tail) !== -1) return text;
    if (markdownCodeRanges(text).some(([from, to]) => tail >= from && tail < to)) return text;
    return text.slice(0, tail) + (next === -1 ? "" : text.slice(next));
  }
  return text;
}

/** Stable identity for one review, for React keys and in-place updates. */
export function proposalReviewKey(review: ProposalReview): string {
  return JSON.stringify([
    review.tool,
    review.target,
    review.verdict,
    review.reviewer,
    review.answers.map(({ id, answer, confidence }) => [id, answer, confidence]),
    review.reason,
  ]);
}
