/**
 * Approve blocks — the `<coven:approve …>` marker protocol that lets a
 * familiar pause and take a STRUCTURED decision inside the transcript, instead
 * of asking its questions in prose and hoping the reply comes back parseable.
 *
 * Same piggyback model as github-blocks/image-blocks: agents embed
 * self-closing markers in the turn text; the transcript strips them at render
 * and mounts a card at the marker's position.
 *
 *   <coven:approve kind="questions" prompt="Which auth approach?"
 *                  options="Session cookies|JWT bearer|OAuth only" />
 *
 * Consecutive markers (only whitespace between them) collapse into ONE card
 * that steps through its questions, so a familiar asks its whole batch in one
 * place. A card holds at most {@link MAX_APPROVE_QUESTIONS}; a longer adjacent
 * run opens ANOTHER card rather than dropping the overflow, because a question
 * the human never sees is a question the familiar never gets answered.
 *
 * Scope: `kind="questions"` only. The `command` and `plan` variants in
 * docs/superpowers/specs/2026-08-20-aicss-chat-approval-and-composer-adaptation-design.md
 * grant execution authority and are deliberately NOT parsed here — an
 * unrecognised kind is dropped, so a build that predates a newer variant never
 * renders it as something weaker than it is.
 *
 * NOTE — there is no auto-approve, by design. The upstream component this
 * adapts (AICSS Approval Card) fires `onApprove` from a 30-second countdown.
 * Nothing here decides for the human: an unanswered card produces no result,
 * forever. That also keeps it consistent with `nextStep.requiresApproval`,
 * which blocks dispatch outright (docs/orchestration-ready-tasks.md).
 *
 * Pure and JSX-free (node --test); the React card lives in
 * src/components/chat-approve-card.tsx.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

/** One question in an approve card. */
export type ApproveQuestion = {
  /** Stable id for the answer payload — explicit `id="…"`, else positional. */
  id: string;
  prompt: string;
  /** Offered choices; always at least {@link MIN_APPROVE_OPTIONS}. */
  options: string[];
  /** Whether a free-text answer is offered alongside the options. */
  allowOther: boolean;
};

/** A decision request rendered by a single card. */
export type ApproveRequestDescriptor = {
  kind: "questions";
  questions: ApproveQuestion[];
};

/** One ordered piece of a prose span after approve extraction. */
export type ApproveTextPiece =
  | { kind: "text"; text: string }
  | { kind: "approve"; request: ApproveRequestDescriptor };

/**
 * Hard cap per card. Three is the point past which a stepper stops reading as
 * "answer this" and starts reading as a form; the upstream component draws the
 * same line. Overflow opens a new card (see the module note) rather than
 * silently discarding a question.
 */
export const MAX_APPROVE_QUESTIONS = 3;

/** Choices offered per question, before the optional free-text answer. */
export const MIN_APPROVE_OPTIONS = 2;
export const MAX_APPROVE_OPTIONS = 6;

// Attribute values must be double-quoted. Besides keeping a `>` inside a
// prompt atomic, this makes a quote-edge malformed marker fail the strict
// match, so the recovery path removes only that marker instead of swallowing
// the prose after it.
const MARKER_RE = /<coven:approve\b((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

const MARKER_PREFIX = "<coven:approve";
const CLOSING_TAG = "</coven:approve";
/** Cheap pre-check shared by every entry point. */
const SNIFF = "<coven:a";

function parseAttrs(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    // A model-generated duplicate is ambiguous, so fail closed rather than
    // choosing one — the same rule image markers use.
    if (Object.hasOwn(out, m[1])) return null;
    out[m[1]] = m[2];
  }
  return out;
}

/** Split an `options="a|b|c"` value into trimmed, de-duplicated choices. */
export function parseApproveOptions(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split("|")) {
    const option = part.trim();
    if (!option) continue;
    if (out.includes(option)) continue;
    out.push(option);
    if (out.length === MAX_APPROVE_OPTIONS) break;
  }
  return out;
}

/**
 * A question from one marker's attributes; null when malformed.
 *
 * `other` defaults to ON: a familiar's fixed options are frequently all
 * slightly wrong, and a card that cannot express that forces the human back
 * into prose — which is the exact failure this protocol exists to remove.
 */
function questionFromAttrs(
  attrs: Record<string, string>,
  index: number,
): ApproveQuestion | null {
  if (attrs.kind !== "questions") return null;
  const prompt = attrs.prompt?.trim();
  if (!prompt) return null;
  const options = parseApproveOptions(attrs.options);
  if (options.length < MIN_APPROVE_OPTIONS) return null;
  const other = attrs.other?.trim().toLowerCase();
  // Anything other than an explicit opt-out keeps free text available.
  const allowOther = other !== "no" && other !== "false";
  const id = attrs.id?.trim() || `q${index + 1}`;
  return { id, prompt, options, allowOther };
}

/** Stable React key for a card (its ordered question ids and prompts). */
export function approveRequestKey(request: ApproveRequestDescriptor): string {
  return request.questions.map((q) => `${q.id}:${q.prompt}`).join("|");
}

/**
 * Render the human's choices as the text of their next turn. Unanswered
 * questions are omitted rather than sent blank — a card can be submitted with
 * only some answers, and inventing an empty answer would put words in the
 * human's mouth.
 */
export function formatApproveAnswers(
  request: ApproveRequestDescriptor,
  answers: Record<string, string>,
): string {
  return request.questions
    .map((question) => {
      const answer = answers[question.id]?.trim();
      return answer ? `${question.prompt} → ${answer}` : null;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Return the next UNQUOTED `>` at/after `from`, or `-1` — quote-aware so a
 *  `>` inside a prompt does not read as a tag close. */
function findUnquotedGt(s: string, from: number): number {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inQuote) {
        inQuote = false;
      } else {
        let before = i - 1;
        while (before >= from && /\s/.test(s[before])) before--;
        // An arbitrary quote in an already-malformed tag is not an attribute
        // delimiter. Only an `=` can open a value quote; otherwise a bad
        // `<coven:approve" …>` prefix would hide every later valid marker.
        inQuote = s[before] === "=";
      }
    } else if (c === ">" && !inQuote) return i;
  }
  return -1;
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Remove malformed approve-marker fragments the strict parser cannot consume.
 * A malformed prefix can otherwise survive beside a later valid marker, making
 * the segmented renderer expose model protocol text. Complete, quote-valid
 * markers and fenced examples remain untouched for their respective callers.
 */
function stripMalformedApproveMarkerFragments(text: string): string {
  if (!text || !text.includes(SNIFF)) return text;
  const codeRanges = markdownCodeRanges(text);
  let out = "";
  let cursor = 0;
  let start = text.indexOf(SNIFF);

  while (start !== -1) {
    if (inRanges(codeRanges, start)) {
      start = text.indexOf(SNIFF, start + SNIFF.length);
      continue;
    }

    MARKER_RE.lastIndex = start;
    const complete = MARKER_RE.exec(text);
    MARKER_RE.lastIndex = 0;
    if (complete?.index === start) {
      start = text.indexOf(SNIFF, start + complete[0].length);
      continue;
    }

    const name = /^<coven:a[a-z]*/.exec(text.slice(start))?.[0] ?? "";
    // `<coven:attention …>` shares this prefix and belongs to another parser.
    // Only claim fragments that are (or are building toward) an approve tag.
    if (!(MARKER_PREFIX.startsWith(name) || name.startsWith(MARKER_PREFIX))) {
      start = text.indexOf(SNIFF, start + SNIFF.length);
      continue;
    }

    // This is not a complete, quote-valid marker, so the next unquoted close
    // is only a recovery boundary. Dropping it fail-closed is safer than
    // showing a malformed protocol tag in the transcript.
    const end = findUnquotedGt(text, start);
    // Do not use a closing `>` from an example as this marker's recovery
    // boundary. A malformed marker before a fenced example must disappear
    // without consuming that literal example (or any later real marker).
    const protectedRange = codeRanges.find(
      ([rangeStart]) => rangeStart > start && (end === -1 || rangeStart < end),
    );
    out += text.slice(cursor, start);
    if (protectedRange) {
      // Keep the line break that makes a fenced block a fenced block; without
      // it, removing the malformed text would turn the example into ordinary
      // prose on the next parsing pass.
      let protectedStart = protectedRange[0];
      if (text[protectedStart - 1] === "\n") {
        protectedStart -= 1;
        if (text[protectedStart - 1] === "\r") protectedStart -= 1;
      }
      cursor = protectedStart;
      start = text.indexOf(SNIFF, protectedRange[1]);
      continue;
    }
    if (end === -1) return out;
    cursor = end + 1;
    start = text.indexOf(SNIFF, cursor);
  }

  return out + text.slice(cursor);
}

/**
 * The protocol is self-closing, so a closing approve marker is always
 * malformed. Remove it outside fences, otherwise a model can leave
 * `</coven:approve>` behind as visible transcript protocol text.
 */
function stripApproveClosingTags(text: string): string {
  if (!text || !text.includes(CLOSING_TAG)) return text;
  const codeRanges = markdownCodeRanges(text);
  let out = "";
  let cursor = 0;
  let start = text.indexOf(CLOSING_TAG);

  while (start !== -1) {
    if (inRanges(codeRanges, start)) {
      start = text.indexOf(CLOSING_TAG, start + CLOSING_TAG.length);
      continue;
    }
    const afterName = text[start + CLOSING_TAG.length] ?? "";
    if (afterName && !/[\s>]/.test(afterName)) {
      start = text.indexOf(CLOSING_TAG, start + CLOSING_TAG.length);
      continue;
    }
    const end = findUnquotedGt(text, start);
    out += text.slice(cursor, start);
    if (end === -1) return out;
    cursor = end + 1;
    start = text.indexOf(CLOSING_TAG, cursor);
  }

  return out + text.slice(cursor);
}

/**
 * Split one prose span into ordered text/approve pieces. Adjacent markers
 * (whitespace-only between them) collapse into one card, up to
 * {@link MAX_APPROVE_QUESTIONS}; the next adjacent marker opens a new card.
 * Fenced markers stay literal example text. Malformed markers are dropped
 * silently — never rendered as raw tags.
 *
 * Returns `[{kind:"text", text}]` unchanged when there is nothing to extract,
 * so callers can cheaply detect "no approve cards".
 */
export function sliceApproveBlocks(text: string): ApproveTextPiece[] {
  // A generation can end with an incomplete marker. Treat that tail exactly as
  // the streaming path does, so a sibling block cannot make the segmented
  // settled renderer expose raw model protocol text.
  const visibleText = stripApproveClosingTags(
    stripMalformedApproveMarkerFragments(stripIncompleteApproveMarker(text)),
  );
  if (!visibleText || !visibleText.includes(MARKER_PREFIX)) {
    return [{ kind: "text", text: visibleText }];
  }

  const codeRanges = markdownCodeRanges(visibleText);
  const pieces: ApproveTextPiece[] = [];
  let cursor = 0;
  /** The card a whitespace-adjacent marker would extend, if any. */
  let openRun: ApproveRequestDescriptor | null = null;
  /** Positional fallback ids stay unique across the whole span. */
  let seen = 0;

  const pushText = (chunk: string) => {
    if (chunk) pieces.push({ kind: "text", text: chunk });
  };

  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(visibleText)) !== null) {
    if (inRanges(codeRanges, m.index)) continue;
    const between = visibleText.slice(cursor, m.index);
    const attrs = parseAttrs(m[1] ?? "");
    const question = attrs ? questionFromAttrs(attrs, seen) : null;
    cursor = m.index + m[0].length;

    if (!question) {
      // Drop the tag, keep the prose around it, and close any open run so a
      // rejected marker never silently welds two unrelated cards together.
      pushText(between);
      openRun = null;
      continue;
    }
    seen += 1;

    // Whitespace-only prose between two markers means the author wrote them as
    // one batch. A full card stops absorbing so the overflow question still
    // reaches the human, in a card of its own.
    const adjacent =
      openRun && between.trim() === "" && openRun.questions.length < MAX_APPROVE_QUESTIONS
        ? openRun
        : null;

    if (adjacent) {
      // Adjacency swallows the whitespace it merged across.
      adjacent.questions.push(question);
      continue;
    }

    pushText(between);
    const request: ApproveRequestDescriptor = { kind: "questions", questions: [question] };
    pieces.push({ kind: "approve", request });
    openRun = request;
  }

  pushText(visibleText.slice(cursor));

  const out = pieces.filter((p) => p.kind === "text" || p.request.questions.length > 0);
  return out.length ? out : [{ kind: "text", text: "" }];
}

/**
 * Remove complete approve markers (outside code fences) plus an unterminated
 * tail — the streaming path, so raw tags never flash before the turn settles.
 */
export function stripApproveMarkers(text: string): string {
  if (!text || !text.includes(SNIFF)) return text;
  const codeRanges = markdownCodeRanges(text);
  MARKER_RE.lastIndex = 0;
  const out = text.replace(MARKER_RE, (m, _attrs, index: number) =>
    inRanges(codeRanges, index) ? m : "",
  );
  return stripApproveClosingTags(
    stripMalformedApproveMarkerFragments(stripIncompleteApproveMarker(out)),
  );
}

/** Remove only an unterminated marker tail, preserving complete markers for
 *  callers that still need to turn them into cards. */
export function stripIncompleteApproveMarker(text: string): string {
  if (!text || !text.includes(SNIFF)) return text;
  const tail = text.lastIndexOf(SNIFF);
  if (tail !== -1 && findUnquotedGt(text, tail) === -1 && !inRanges(markdownCodeRanges(text), tail)) {
    const frag = text.slice(tail);
    const afterName = frag.slice(MARKER_PREFIX.length, MARKER_PREFIX.length + 1);
    // `<coven:attention…` also starts with the sniff prefix; only hide a tail
    // that is still a viable approve marker.
    if (
      MARKER_PREFIX.startsWith(frag.slice(0, MARKER_PREFIX.length))
      && (!afterName || /[\s/>]/.test(afterName))
    ) {
      return text.slice(0, tail);
    }
  }
  return text;
}
