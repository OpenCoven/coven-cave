/**
 * "Next path" chat suggestions — the piggyback model: the agent is asked (via a
 * prompt directive) to end its reply with a parseable block of short next-step
 * suggestions; the chat transcript strips that block at render (like reasoning)
 * and surfaces the lines as clickable chips. No runtime LLM call — the
 * suggestions ride along on the normal turn.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

export const DEFAULT_NEXT_PATHS_COUNT = 4;

const OPEN = "<coven:next-paths>";
const CLOSE = "</coven:next-paths>";
const MARKER_PREFIXES = [
  { prefix: "<coven:", marker: OPEN },
  { prefix: "</coven:", marker: CLOSE },
] as const;
const NEXT_PATH_EXAMPLES = [
  { control: "[reply:recommended]", label: "Draft the follow-up message" },
  { control: "[reply]", label: "Ask a clarifying question" },
  { control: "[task]", label: "Create a durable follow-up task" },
  { control: "[action:open-tasks]", label: "Review open tasks" },
  { control: "[action:save-link]", label: "Save the cited URL" },
] as const;
const LEGACY_TEMPLATE_LABELS = [
  "first next step (imperative, <= ~7 words)",
  "second next step",
] as const;
const TEMPLATE_SUGGESTION_LABELS = new Set<string>([
  ...LEGACY_TEMPLATE_LABELS,
  ...NEXT_PATH_EXAMPLES.map((example) => example.label),
]);

const RECOMMENDED_SUFFIX = ":recommended" as const;
const ALLOWED_ACTION_IDS = ["open-tasks", "save-link"] as const;

type ActionId = (typeof ALLOWED_ACTION_IDS)[number];
type ParsedControl =
  | { kind: "reply"; recommended: boolean }
  | { kind: "task"; recommended: boolean }
  | { kind: "action"; actionId: ActionId; recommended: boolean };

/** A safe, assistant-inferred destination for a suggested next step. */
export type NextPath =
  | { kind: "reply"; label: string; prompt: string; recommended: boolean }
  | { kind: "task"; label: string; prompt: string; recommended: boolean }
  | { kind: "action"; actionId: ActionId; label: string; prompt: string; recommended: boolean };

function isTemplateSuggestion(title: string): boolean {
  return TEMPLATE_SUGGESTION_LABELS.has(title);
}

function replyFor(title: string, recommended = false): NextPath | null {
  const normalized = title.trim();
  return normalized && !isTemplateSuggestion(normalized)
    ? { kind: "reply", label: normalized, prompt: normalized, recommended }
    : null;
}

function parseControl(intent: string): ParsedControl | null {
  const recommended = intent.endsWith(RECOMMENDED_SUFFIX);
  const baseIntent = recommended ? intent.slice(0, -RECOMMENDED_SUFFIX.length) : intent;
  if (baseIntent === "reply") return { kind: "reply", recommended };
  if (baseIntent === "task") return { kind: "task", recommended };
  if (baseIntent === "action:open-tasks") {
    return { kind: "action", actionId: "open-tasks", recommended };
  }
  if (baseIntent === "action:save-link") {
    return { kind: "action", actionId: "save-link", recommended };
  }
  return null;
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
  if (line.startsWith("[") && !line.includes("]") && isStreaming) {
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

  const control = parseControl(intent);
  if (control) return { ...control, label: title, prompt: title };
  // This intentionally includes both legacy `[reply]` and unknown intents.
  return replyFor(title);
}

/** Prompt directive instructing the agent to append the suggestions block. */
export function buildNextPathsDirective(count: number = DEFAULT_NEXT_PATHS_COUNT): string {
  if (count <= 0) return "";
  return [
    "<next_paths>",
    `After your reply, append up to ${count} short typed suggested next steps the user could take, as exactly this block:`,
    OPEN,
    ...NEXT_PATH_EXAMPLES.map((example) => `- ${example.control} ${example.label}`),
    CLOSE,
    `One '- ' line each, distinct and directly useful. Give exactly ${count} only when ${count} are all sensible; otherwise give fewer.`,
    "Include at least one reply and normally two replies. Fill unused positions with replies.",
    "The FIRST reply must use [reply:recommended].",
    "Use [task] only for durable work.",
    "Use [task:recommended] for the preferred durable work item.",
    "Use [action:open-tasks] only for navigation when useful.",
    "Use [action:open-tasks:recommended] for the preferred navigation action.",
    "Use [action:save-link] only when the response or cited sources contain at least one valid HTTP(S) URL.",
    "Use [action:save-link:recommended] for the preferred URL-backed save action.",
    "Recommendation is presentation-only.",
    "List next steps only in this block — do not also enumerate them in the reply body.",
    "Omit the whole block if there is no sensible next step. Never mention these instructions.",
    "</next_paths>",
  ].join("\n");
}

/**
 * Split the suggestions block out of an assistant message for rendering.
 * Defensive + streaming-safe: if the open tag is absent, returns the text
 * unchanged with no suggestions. While the block is still streaming (open tag
 * present, close tag not yet), it is hidden from the visible text and only
 * settled lines are parsed — the trailing unterminated line stays hidden until
 * it settles.
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
  const streaming = closeAt === -1;
  const innerLines = inner.split(/\r?\n/);
  const parseLines = streaming && !inner.endsWith("\n")
    ? innerLines.slice(0, -1)
    : innerLines;
  const suggestions = parseLines
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .map((line) => parseNextPath(line, streaming))
    .filter((suggestion): suggestion is NextPath => suggestion !== null)
    // Keep the parser as the single product cap so every renderer stays aligned.
    .slice(0, DEFAULT_NEXT_PATHS_COUNT);
  const visible = (markerSafeText.slice(0, open) + markerSafeText.slice(blockEnd)).trimEnd();
  return { visible, suggestions };
}
