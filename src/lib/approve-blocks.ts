import { markdownCodeRanges } from "./github-blocks.ts";

export type ApproveQuestion = {
  /** Safe, unique explicit ids are preserved; other ids get a stable suffix. */
  id: string;
  prompt: string;
  options: string[];
  allowOther: boolean;
};

export type ApproveRequestDescriptor = {
  kind: "questions";
  questions: ApproveQuestion[];
};

export type ApproveTextPiece =
  | { kind: "text"; text: string }
  | { kind: "approve"; request: ApproveRequestDescriptor };

export const MAX_APPROVE_QUESTIONS = 3;
export const MIN_APPROVE_OPTIONS = 2;
export const MAX_APPROVE_OPTIONS = 6;

const MARKER_NAME = "approve";
const ALLOWED_ATTRS = new Set(["kind", "id", "prompt", "options", "other"]);
const RESERVED_ANSWER_IDS = new Set(Object.getOwnPropertyNames(Object.prototype));
// A new protocol opener always belongs to its own marker, even after a broken
// quote. Never let a later marker's quotes complete this one.
const MARKER_RE = /<coven:approve\b((?:\s+[a-zA-Z-]+="(?:(?!<\/?coven:)[^"])*")*)\s*\/>/y;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

type ApproveMarker = {
  start: number;
  end: number;
  complete: boolean;
  question: ApproveQuestion | null;
};

export function parseApproveOptions(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split("|").map((part) => part.trim()).filter(Boolean))]
    .slice(0, MAX_APPROVE_OPTIONS);
}

function parseQuestion(rawAttrs: string): ApproveQuestion | null {
  const attrs = new Map<string, string>();
  for (const match of rawAttrs.matchAll(ATTR_RE)) {
    if (!ALLOWED_ATTRS.has(match[1]) || attrs.has(match[1])) return null;
    attrs.set(match[1], match[2]);
  }
  if (attrs.get("kind") !== "questions") return null;
  const prompt = attrs.get("prompt")?.trim() ?? "";
  const options = parseApproveOptions(attrs.get("options"));
  if (!prompt || options.length < MIN_APPROVE_OPTIONS) return null;
  const other = attrs.get("other")?.trim().toLowerCase();
  return {
    id: attrs.get("id")?.trim() ?? "",
    prompt,
    options,
    allowOther: other !== "no" && other !== "false",
  };
}

/** Include every answer-affecting field, with unambiguous boundaries. */
export function approveRequestKey(request: ApproveRequestDescriptor): string {
  return JSON.stringify([
    request.kind,
    request.questions.map(({ id, prompt, options, allowOther }) => [id, prompt, options, allowOther]),
  ]);
}

/** Plain next-user-turn text; this function never sends or grants authority. */
export function formatApproveAnswers(
  request: ApproveRequestDescriptor,
  answers: Record<string, string>,
): string {
  return request.questions.flatMap((question) => {
    if (!Object.hasOwn(answers, question.id)) return [];
    const answer = answers[question.id]?.trim();
    return answer ? [`${question.prompt} → ${answer}`] : [];
  }).join("\n");
}

function recoverMarkerEnd(text: string, start: number): { end: number; complete: boolean } {
  let inQuote = false;
  let firstGt = -1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (index > start && /^<\/?coven:/.test(text.slice(index, index + 9))) {
      return { end: firstGt === -1 ? index : firstGt + 1, complete: firstGt !== -1 };
    }
    if (
      char === "\n"
      || char === "\r"
      || (char === "`" && (!inQuote || hasClosingCodeDelimiter(text, index)))
    ) {
      // Preserve prose/code on the next line. Attribute continuations still
      // belong to an incomplete multiline marker, not to visible prose.
      if (char !== "`" && /^\s+[a-zA-Z-]+(?:\s*=|$)/.test(text.slice(index))) continue;
      return { end: firstGt === -1 ? index : firstGt + 1, complete: firstGt !== -1 };
    }
    if (char === '"') {
      if (inQuote) inQuote = false;
      else {
        let before = index - 1;
        while (before >= start && /\s/.test(text[before])) before -= 1;
        inQuote = text[before] === "=";
      }
    } else if (char === ">") {
      if (!inQuote) return { end: index + 1, complete: true };
      if (firstGt === -1) firstGt = index;
    }
  }
  return { end: firstGt === -1 ? text.length : firstGt + 1, complete: firstGt !== -1 };
}

function hasClosingCodeDelimiter(text: string, start: number): boolean {
  const delimiter = /^`+/.exec(text.slice(start))?.[0] ?? "";
  const lineEnd = text.indexOf("\n", start);
  let cursor = start + delimiter.length;
  while (cursor < text.length && (lineEnd === -1 || cursor < lineEnd)) {
    // Attribute backticks in a later valid marker are not code delimiters.
    MARKER_RE.lastIndex = cursor;
    const marker = text[cursor] === "<" ? MARKER_RE.exec(text) : null;
    if (marker) {
      cursor += marker[0].length;
      continue;
    }
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const runStart = cursor;
    while (text[cursor] === "`") cursor += 1;
    if (cursor - runStart === delimiter.length) return true;
  }
  return false;
}

/**
 * Scan first, then mask marker contents before finding Markdown code ranges.
 * Backticks inside protocol attributes must not open a code span that hides
 * later cards. Delimiters surrounding literal examples remain unmasked.
 */
function scanApproveMarkers(text: string): ApproveMarker[] {
  const candidates: ApproveMarker[] = [];
  const starts = /<\/?coven:([a-zA-Z-]*)/g;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const name = match[1];
    if (!name || !(MARKER_NAME.startsWith(name) || name.startsWith(MARKER_NAME))) continue;
    MARKER_RE.lastIndex = match.index;
    const marker = MARKER_RE.exec(text);
    const recovery = marker
      ? { end: match.index + marker[0].length, complete: true }
      : recoverMarkerEnd(text, match.index);
    candidates.push({
      start: match.index,
      ...recovery,
      question: marker ? parseQuestion(marker[1]) : null,
    });
    starts.lastIndex = recovery.end;
  }
  if (!candidates.length) return [];

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

function assignQuestionIds(markers: ApproveMarker[]): void {
  const questions = markers.flatMap(({ question }) => question ? [question] : []);
  const explicitIds = new Set(questions.map(({ id }) => id).filter(Boolean));
  const used = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const explicit = question.id;
    const base = explicit || `q${index + 1}`;
    let id = base;
    let suffix = 2;
    while (
      RESERVED_ANSWER_IDS.has(id)
      || used.has(id)
      || (!explicit && explicitIds.has(id))
      || (id !== base && explicitIds.has(id))
    ) {
      id = `${base}#${suffix++}`;
    }
    question.id = id;
    used.add(id);
  }
}

/** Whitespace-adjacent questions share a card; overflow is never discarded. */
export function sliceApproveBlocks(text: string): ApproveTextPiece[] {
  const markers = scanApproveMarkers(text);
  assignQuestionIds(markers);
  const pieces: ApproveTextPiece[] = [];
  let cursor = 0;
  let openRun: ApproveRequestDescriptor | null = null;
  const pushText = (chunk: string) => {
    if (chunk) pieces.push({ kind: "text", text: chunk });
  };
  for (const marker of markers) {
    const between = text.slice(cursor, marker.start);
    cursor = marker.end;
    if (!marker.question) {
      pushText(between);
      openRun = null;
    } else if (openRun && !between.trim() && openRun.questions.length < MAX_APPROVE_QUESTIONS) {
      openRun.questions.push(marker.question);
    } else {
      pushText(between);
      openRun = { kind: "questions", questions: [marker.question] };
      pieces.push({ kind: "approve", request: openRun });
    }
  }
  pushText(text.slice(cursor));
  return pieces.length ? pieces : [{ kind: "text", text: "" }];
}

function rewriteApproveMarkers(
  text: string,
  replace: (marker: ApproveMarker, raw: string) => string,
): string {
  let output = "";
  let cursor = 0;
  for (const marker of scanApproveMarkers(text)) {
    output += text.slice(cursor, marker.start) + replace(marker, text.slice(marker.start, marker.end));
    cursor = marker.end;
  }
  return output + text.slice(cursor);
}

/** Only valid question markers may enter the rich-card pipeline. */
export function sanitizeApproveMarkers(text: string): string {
  return rewriteApproveMarkers(text, (marker, raw) => marker.question ? raw : "");
}

/** Remove protocol outside code, including unknown kinds and broken tails. */
export function stripApproveMarkers(text: string): string {
  return rewriteApproveMarkers(text, () => "");
}

/** Compatibility helper for callers retaining complete markers during streaming. */
export function stripIncompleteApproveMarker(text: string): string {
  return rewriteApproveMarkers(text, (marker, raw) => marker.complete ? raw : "");
}

/**
 * Keep valid question attributes opaque to sibling control parsers. In
 * particular a backtick in a prompt must not hide a later attention/result
 * marker or reasoning block. Restore into card/persisted text and reasoning
 * only after those parsers have run; remove from prose-only projections.
 */
export function protectApproveMarkers(text: string): {
  text: string;
  restore: (value: string, keepMarkers: boolean) => string;
} {
  let prefix = "\uE000coven-questions:";
  while (text.includes(prefix)) prefix += ":";
  const markers: string[] = [];
  const protectedText = rewriteApproveMarkers(text, (marker, raw) => {
    if (!marker.question) return "";
    const token = `${prefix}${markers.length}\uE001`;
    markers.push(raw);
    return token;
  });
  return {
    text: protectedText,
    restore: (value, keepMarkers) => value.replace(
      new RegExp(`${prefix}(\\d+)\uE001`, "g"),
      (token, index: string) => markers[Number(index)] === undefined
        ? token
        : keepMarkers ? markers[Number(index)] : "",
    ),
  };
}
