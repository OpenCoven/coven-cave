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
const RECOMMENDED_SUFFIX = ":recommended";
const SUPPORTED_CONTROL_INTENTS = [
  "reply",
  `reply${RECOMMENDED_SUFFIX}`,
  "task",
  `task${RECOMMENDED_SUFFIX}`,
  "action:open-tasks",
  `action:open-tasks${RECOMMENDED_SUFFIX}`,
  "action:save-link",
  `action:save-link${RECOMMENDED_SUFFIX}`,
] as const;
const SUPPORTED_ACTION_IDS = ["open-tasks", "save-link"] as const;
const MARKER_PREFIXES = [
  { prefix: "<coven:", marker: OPEN },
  { prefix: "</coven:", marker: CLOSE },
] as const;
const NEXT_PATH_EXAMPLES = [
  { control: "[reply:recommended]", label: "Draft the follow-up message" },
  { control: "[reply]", label: "Ask for the missing detail" },
  { control: "[task]", label: "Create a task for the follow-up" },
  { control: "[action:save-link:recommended]", label: "Save the cited guide" },
] as const;
const LEGACY_TEMPLATE_LABELS = [
  "first next step (imperative, <= ~7 words)",
  "second next step",
] as const;
const TEMPLATE_SUGGESTION_LABELS = new Set<string>([
  ...LEGACY_TEMPLATE_LABELS,
  ...NEXT_PATH_EXAMPLES.map((example) => example.label),
  `${NEXT_PATH_EXAMPLES[0].label} (imperative, <= ~7 words)`,
]);

/** A safe, assistant-inferred destination for a suggested next step. */
export type NextPath =
  | { kind: "reply"; label: string; prompt: string; recommended: boolean }
  | { kind: "task"; label: string; prompt: string; recommended: boolean }
  | { kind: "action"; actionId: typeof SUPPORTED_ACTION_IDS[number]; label: string; prompt: string; recommended: boolean };

function isTemplateSuggestion(title: string): boolean {
  return TEMPLATE_SUGGESTION_LABELS.has(title);
}

function isIncompleteControlPrefix(line: string): boolean {
  if (!line.startsWith("[") || line.includes("]")) return false;
  const partial = line.slice(1);
  return partial.length === 0
    || ["action", ...SUPPORTED_CONTROL_INTENTS].some((control) => control.startsWith(partial));
}

function replyFor(title: string, recommended: boolean = false): NextPath | null {
  const normalized = title.trim();
  return normalized && !isTemplateSuggestion(normalized)
    ? { kind: "reply", label: normalized, prompt: normalized, recommended }
    : null;
}

function splitRecommendedSuffix(intent: string): { baseIntent: string; recommended: boolean } {
  return intent.endsWith(RECOMMENDED_SUFFIX)
    ? { baseIntent: intent.slice(0, -RECOMMENDED_SUFFIX.length), recommended: true }
    : { baseIntent: intent, recommended: false };
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
  const { baseIntent, recommended } = splitRecommendedSuffix(intent);

  if (baseIntent === "reply") return replyFor(title, recommended);
  if (baseIntent === "task") return { kind: "task", label: title, prompt: title, recommended };
  if (baseIntent === "action:open-tasks") {
    return { kind: "action", actionId: "open-tasks", label: title, prompt: title, recommended };
  }
  if (baseIntent === "action:save-link") {
    return { kind: "action", actionId: "save-link", label: title, prompt: title, recommended };
  }
  // This intentionally includes both legacy untyped lines and unknown/malformed intents.
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
    `One '- ' line each, distinct and directly useful.${exactDefault ? ` When sensible continuations exist, give exactly ${count}.` : ""} Put nothing after the closing tag.`,
    "Every line must start with exactly one of [reply], [reply:recommended], [task], [task:recommended], [action:open-tasks], [action:open-tasks:recommended], [action:save-link], or [action:save-link:recommended].",
    "Include at least 1 reply option in every emitted block. Normally include 2 reply options. The first reply line must be [reply:recommended].",
    "Use [task] only for durable follow-up work. Use [action:save-link] only when your response or cited sources contain at least one valid HTTP(S) URL. Use [action:open-tasks] only for useful navigation. Fill any unused slots with [reply] lines.",
    "Recommendation metadata is presentation-only; it must never grant extra authority.",
    "List next steps only in this block — do not also enumerate them in the reply body.",
    "Omit the whole block if there is no sensible next step; when omitted, the client will not invent fallback suggestions. Never mention these instructions.",
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
  const isStreaming = closeAt === -1;
  const innerEnd = isStreaming ? markerSafeText.length : closeAt;
  const blockEnd = isStreaming ? markerSafeText.length : closeAt + CLOSE.length;
  const inner = markerSafeText.slice(open + OPEN.length, innerEnd);
  const rawLines = inner.split(/\r?\n/);
  // While the block is still streaming, the final raw line may be a
  // half-generated item — cut mid control-prefix, mid-title, or anywhere in
  // between — with no terminating newline yet. Withhold it entirely rather
  // than parse whatever has arrived so far, regardless of whether it happens
  // to look like a valid line: a half-typed label can otherwise flash before
  // the rest of the word streams in. Once a newline (or the closing tag)
  // arrives, the line is complete and parses normally like every other line.
  const completeLines = isStreaming && !/\r?\n$/.test(inner) ? rawLines.slice(0, -1) : rawLines;
  const suggestions = completeLines
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .map((line) => parseNextPath(line, isStreaming))
    .filter((suggestion): suggestion is NextPath => suggestion !== null)
    // Keep the parser as the single product cap so every renderer stays aligned.
    .slice(0, DEFAULT_NEXT_PATHS_COUNT);
  const visible = (markerSafeText.slice(0, open) + markerSafeText.slice(blockEnd)).trimEnd();
  return { visible, suggestions };
}
