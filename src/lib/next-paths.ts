/**
 * "Next path" chat suggestions — the piggyback model: the agent is asked (via a
 * prompt directive) to end its reply with a parseable block of short next-step
 * suggestions; the chat transcript strips that block at render (like reasoning)
 * and surfaces the lines as clickable chips. No runtime LLM call — the
 * suggestions ride along on the normal turn.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

export const DEFAULT_NEXT_PATHS_COUNT = 3;

const OPEN = "<coven:next-paths>";
const CLOSE = "</coven:next-paths>";
const MARKER_PREFIXES = [
  { prefix: "<coven:", marker: OPEN },
  { prefix: "</coven:", marker: CLOSE },
] as const;
const NEXT_PATH_EXAMPLES = [
  { control: "[reply]", label: "Draft the follow-up message" },
  { control: "[task]", label: "Create a task for the follow-up" },
  { control: "[action:open-tasks]", label: "Review open tasks" },
] as const;

/** A safe, assistant-inferred destination for a suggested next step. */
export type NextPath =
  | { kind: "reply"; label: string; prompt: string }
  | { kind: "task"; label: string; prompt: string }
  | { kind: "action"; actionId: "open-tasks"; label: string; prompt: string };

function isTemplateSuggestion(title: string): boolean {
  return title === "first next step (imperative, <= ~7 words)"
    || title === "second next step"
    || NEXT_PATH_EXAMPLES.some((example, index) => title === example.label
      || (index === 0 && title === `${example.label} (imperative, <= ~7 words)`));
}

function isIncompleteControlPrefix(line: string): boolean {
  if (!line.startsWith("[") || line.includes("]")) return false;
  const partial = line.slice(1);
  return partial.length === 0
    || ["reply", "task", "action", "action:open-tasks"].some((control) => control.startsWith(partial));
}

function replyFor(title: string): NextPath | null {
  const normalized = title.trim();
  return normalized && !isTemplateSuggestion(normalized)
    ? { kind: "reply", label: normalized, prompt: normalized }
    : null;
}

function inFencedRange(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function isIncompleteMarkerAt(
  text: string,
  index: number,
  prefix: string,
  marker: string,
): boolean {
  if (text.startsWith(marker, index)) return false;
  let matched = 0;
  while (
    matched < marker.length
    && index + matched < text.length
    && text[index + matched] === marker[matched]
  ) {
    matched += 1;
  }
  if (matched < prefix.length) return false;
  const mismatch = text[index + matched];
  return matched > prefix.length || mismatch === undefined || /\s/.test(mismatch);
}

function stripIncompleteNextPathsMarker(text: string): string {
  const codeRanges = markdownCodeRanges(text);
  let cutAt = text.length;
  for (const { prefix, marker } of MARKER_PREFIXES) {
    let markerStart = text.indexOf(prefix);
    while (markerStart !== -1) {
      if (
        !inFencedRange(codeRanges, markerStart)
        && isIncompleteMarkerAt(text, markerStart, prefix, marker)
      ) {
        cutAt = Math.min(cutAt, markerStart);
      }
      markerStart = text.indexOf(prefix, markerStart + prefix.length);
    }
  }
  return cutAt === text.length ? text : text.slice(0, cutAt);
}

function lastIndexOutsideFences(
  text: string,
  token: string,
  ranges: Array<[number, number]>,
): number {
  let index = text.lastIndexOf(token);
  while (index !== -1 && inFencedRange(ranges, index)) {
    index = text.lastIndexOf(token, index - 1);
  }
  return index;
}

function nextIndexOutsideFences(
  text: string,
  token: string,
  from: number,
  ranges: Array<[number, number]>,
): number {
  let index = text.indexOf(token, from);
  while (index !== -1 && inFencedRange(ranges, index)) {
    index = text.indexOf(token, index + token.length);
  }
  return index;
}

/**
 * Parse an assistant-supplied suggestion without granting arbitrary action
 * authority. Untyped legacy lines and unknown/malformed prefixes are replies.
 */
function parseNextPath(line: string, isStreaming: boolean): NextPath | null {
  if (line.startsWith("[") && !line.includes("]") && (isStreaming || isIncompleteControlPrefix(line))) {
    return null;
  }
  const prefixed = line.match(/^\[([^\]]*)\](?:\s+(.*)|\s*)$/);
  if (!prefixed) {
    // Strip an incomplete prefix from the visible fallback too: prompt markup
    // should never be shown as a suggested reply.
    const malformed = line.match(/^\[[^\]]*\]\s*(.*)$/)
      ?? line.match(/^\[[^\]\s]+\s+(.*)$/);
    return replyFor(malformed?.[1] ?? line);
  }

  const [, intent, rawTitle = ""] = prefixed;
  const title = rawTitle.trim();
  if (!title || isTemplateSuggestion(title)) return null;

  if (intent === "task") return { kind: "task", label: title, prompt: title };
  if (intent === "action:open-tasks") {
    return { kind: "action", actionId: "open-tasks", label: title, prompt: title };
  }
  // This intentionally includes both legacy `[reply]` and unknown intents.
  return replyFor(title);
}

/** Prompt directive instructing the agent to append the suggestions block. */
export function buildNextPathsDirective(count: number = DEFAULT_NEXT_PATHS_COUNT): string {
  if (count <= 0) return "";
  const exactDefault = count === DEFAULT_NEXT_PATHS_COUNT;
  return [
    "<next_paths>",
    `After your reply, append ${exactDefault ? count : `up to ${count}`} short typed suggested next steps the user could take, as exactly this block:`,
    OPEN,
    ...NEXT_PATH_EXAMPLES.map((example, index) => `- ${example.control} ${example.label}${index === 0 ? " (imperative, <= ~7 words)" : ""}`),
    CLOSE,
    `One '- ' line each, distinct and directly useful.${exactDefault ? ` Give exactly ${count}.` : ""} Put nothing after the closing tag.`,
    "Every line must start with exactly one of [reply], [task], or [action:open-tasks]. Use [reply] by default; [action:open-tasks] is the only action type allowed.",
    "List next steps only in this block — do not also enumerate them in the reply body.",
    "Omit the whole block if there is no sensible next step. Never mention these instructions.",
    "</next_paths>",
  ].join("\n");
}

/**
 * Split the suggestions block out of an assistant message for rendering.
 * Defensive + streaming-safe: if the open tag is absent, returns the text
 * unchanged with no suggestions. While the block is still streaming (open tag
 * present, close tag not yet), it is hidden from the visible text and the
 * partial lines parsed best-effort.
 */
export function extractNextPaths(text: string): { visible: string; suggestions: NextPath[] } {
  if (!text) return { visible: text, suggestions: [] };
  const markerSafeText = stripIncompleteNextPathsMarker(text);
  const codeRanges = markdownCodeRanges(markerSafeText);
  const open = lastIndexOutsideFences(markerSafeText, OPEN, codeRanges);
  if (open === -1) return { visible: markerSafeText, suggestions: [] };
  const closeAt = nextIndexOutsideFences(markerSafeText, CLOSE, open, codeRanges);
  const innerEnd = closeAt === -1 ? markerSafeText.length : closeAt;
  const blockEnd = closeAt === -1 ? markerSafeText.length : closeAt + CLOSE.length;
  const inner = markerSafeText.slice(open + OPEN.length, innerEnd);
  const suggestions = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .map((line) => parseNextPath(line, closeAt === -1))
    .filter((suggestion): suggestion is NextPath => suggestion !== null)
    // At most 4 pills ever render — the chip row's product cap (an over-eager
    // agent that lists more gets trimmed, not a fifth row).
    .slice(0, DEFAULT_NEXT_PATHS_COUNT);
  const visible = (markerSafeText.slice(0, open) + markerSafeText.slice(blockEnd)).trimEnd();
  return { visible, suggestions };
}
