/**
 * "Next path" chat suggestions — the piggyback model: the agent is asked (via a
 * prompt directive) to end its reply with a parseable block of short next-step
 * suggestions; the chat transcript strips that block at render (like reasoning)
 * and surfaces the lines as clickable chips. No runtime LLM call — the
 * suggestions ride along on the normal turn.
 */

import { markdownCodeRanges } from "./github-blocks.ts";
import type { AgenticEvidenceRef } from "./agentic-recommendations.ts";
import { containsSecretText } from "./secret-redaction.ts";

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
  { control: "[task]", label: "Open the follow-up task" },
  { control: "[action:save-link:recommended]", label: "Save the cited link" },
] as const;
const LEGACY_TEMPLATE_LABELS = [
  "Draft the follow-up message (imperative, <= ~7 words)",
  "second next step",
] as const;
const TEMPLATE_SUGGESTION_LABELS = new Set<string>([
  ...LEGACY_TEMPLATE_LABELS,
  ...NEXT_PATH_EXAMPLES.map((example) => example.label),
]);

type Recommendation = { recommended: boolean };

/** A safe, assistant-inferred destination for a suggested next step. */
export type NextPath =
  | ({ kind: "reply"; label: string; prompt: string } & Recommendation & { metadata?: NextPathMetadata })
  | ({ kind: "task"; label: string; prompt: string } & Recommendation & { metadata?: NextPathMetadata })
  | ({
      kind: "action";
      actionId: "open-tasks" | "save-link";
      label: string;
      prompt: string;
    } & Recommendation & { metadata?: NextPathMetadata });

export type NextPathMetadata = {
  rationale: string;
  evidenceRefs: AgenticEvidenceRef[];
};

export type NextPathContext = {
  messageId?: string | null;
  taskId?: string | null;
  toolOutcomeIds?: readonly string[];
};

const MAX_NEXT_PATH_RATIONALE_CHARS = 240;
const MAX_NEXT_PATH_EVIDENCE_REFS = 3;
const SAFE_EVIDENCE_ID_RE = /^(?:[A-Za-z][A-Za-z0-9._:/-]{0,95}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const NEXT_PATH_EVIDENCE_LABELS: Record<"message" | "task" | "artifact", string> = {
  message: "Recent chat message",
  task: "Linked task",
  artifact: "Recent tool outcome",
};

function isTemplateSuggestion(title: string): boolean {
  return TEMPLATE_SUGGESTION_LABELS.has(title);
}

function splitRecommendation(intent: string): { baseIntent: string; recommended: boolean } {
  const suffix = ":recommended";
  return intent.endsWith(suffix)
    ? { baseIntent: intent.slice(0, -suffix.length), recommended: true }
    : { baseIntent: intent, recommended: false };
}

function replyFor(title: string, metadata?: NextPathMetadata): NextPath | null {
  const normalized = title.trim();
  return normalized && !isTemplateSuggestion(normalized)
    ? { kind: "reply", label: normalized, prompt: normalized, recommended: false, ...(metadata ? { metadata } : {}) }
    : null;
}

function validEvidenceId(value: string): boolean {
  return SAFE_EVIDENCE_ID_RE.test(value) && !containsSecretText(value);
}

function parseNextPathMetadata(attributes: string): NextPathMetadata | null {
  const match = /^\s*rationale="([^"]{1,240})"\s+evidence="([^"]{1,480})"\s*$/.exec(attributes);
  if (!match) return null;
  const rationale = match[1]!.trim();
  if (!rationale || rationale.length > MAX_NEXT_PATH_RATIONALE_CHARS || containsSecretText(rationale)) {
    return null;
  }

  const evidenceRefs: AgenticEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const value of match[2]!.split("|")) {
    const evidence = /^(message|task|artifact):(.+)$/.exec(value.trim());
    if (!evidence) return null;
    const kind = evidence[1] as "message" | "task" | "artifact";
    const id = evidence[2]!.trim();
    const key = `${kind}:${id}`;
    if (!validEvidenceId(id) || seen.has(key)) return null;
    seen.add(key);
    evidenceRefs.push({ id, kind, label: NEXT_PATH_EVIDENCE_LABELS[kind] });
    if (evidenceRefs.length > MAX_NEXT_PATH_EVIDENCE_REFS) return null;
  }
  return evidenceRefs.length > 0 ? { rationale, evidenceRefs } : null;
}

function nextPathFor(
  kind: "reply" | "task" | "action:open-tasks" | "action:save-link",
  title: string,
  recommended: boolean,
  metadata?: NextPathMetadata,
): NextPath | null {
  const normalized = title.trim();
  if (!normalized || isTemplateSuggestion(normalized)) return null;
  const metadataFields = metadata ? { metadata } : {};
  if (kind === "reply") return { kind: "reply", label: normalized, prompt: normalized, recommended, ...metadataFields };
  if (kind === "task") return { kind: "task", label: normalized, prompt: normalized, recommended, ...metadataFields };
  if (kind === "action:open-tasks") {
    return {
      kind: "action",
      actionId: "open-tasks",
      label: normalized,
      prompt: normalized,
      recommended,
      ...metadataFields,
    };
  }
  return {
    kind: "action",
    actionId: "save-link",
    label: normalized,
    prompt: normalized,
    recommended,
    ...metadataFields,
  };
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
function parseNextPath(line: string): NextPath | null {
  if (line.startsWith("[") && !line.includes("]")) {
    return null;
  }
  const tagged = /^\[([^\]\s]+)(?:\s+([^\]]+))?\](?:\s+(.*)|\s*)$/.exec(line);
  if (tagged) {
    const { baseIntent, recommended } = splitRecommendation(tagged[1]!);
    const metadata = tagged[2] === undefined ? undefined : parseNextPathMetadata(tagged[2]);
    if (tagged[2] !== undefined && !metadata) return null;
    const resolvedMetadata = metadata ?? undefined;
    const title = tagged[3] ?? "";
    if (baseIntent === "reply") return nextPathFor("reply", title, recommended, resolvedMetadata);
    if (baseIntent === "task") return nextPathFor("task", title, recommended, resolvedMetadata);
    if (baseIntent === "action:open-tasks") return nextPathFor("action:open-tasks", title, recommended, resolvedMetadata);
    if (baseIntent === "action:save-link") return nextPathFor("action:save-link", title, recommended, resolvedMetadata);
    return replyFor(title);
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
  const { baseIntent, recommended } = splitRecommendation(intent);
  const title = rawTitle.trim();
  if (!title || isTemplateSuggestion(title)) return null;

  if (baseIntent === "reply") return nextPathFor("reply", title, recommended);
  if (baseIntent === "task") return nextPathFor("task", title, recommended);
  if (baseIntent === "action:open-tasks") return nextPathFor("action:open-tasks", title, recommended);
  if (baseIntent === "action:save-link") return nextPathFor("action:save-link", title, recommended);
  // This intentionally includes both legacy `[reply]` and unknown intents.
  return replyFor(title);
}

/** Prompt directive instructing the agent to append the suggestions block. */
export function buildNextPathsDirective(count: number = DEFAULT_NEXT_PATHS_COUNT): string {
  if (count <= 0) return "";
  const exactDefault = count === DEFAULT_NEXT_PATHS_COUNT;
  const examples = NEXT_PATH_EXAMPLES.slice(0, Math.min(count, NEXT_PATH_EXAMPLES.length));
  return [
    "<next_paths>",
    `After your reply, append ${exactDefault ? `exactly ${count}` : `up to ${count}`} short typed suggested next steps the user could take, as exactly this block:`,
    OPEN,
    ...examples.map((example) => `- ${example.control} ${example.label}`),
    CLOSE,
    "One '- ' line each, distinct and directly useful. Normally make the first two suggestions replies; normally two replies are best. The first reply must use [reply:recommended].",
    "Use [task], [action:open-tasks], and [action:save-link] only when useful.",
    "Use [action:save-link:recommended] only when the response or cited sources contain at least one valid HTTP(S) URL. The :recommended suffix affects presentation only; it never grants authority.",
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
    .map((line) => parseNextPath(line))
    .filter((suggestion): suggestion is NextPath => suggestion !== null)
    // Keep the parser as the single product cap so every renderer stays aligned.
    .slice(0, DEFAULT_NEXT_PATHS_COUNT);
  const visible = (markerSafeText.slice(0, open) + markerSafeText.slice(blockEnd)).trimEnd();
  return { visible, suggestions };
}

/**
 * The chat surface resolves its current message, task, and tool context after
 * parsing. This keeps model output bounded while attaching only existing IDs.
 */
export function contextualizeNextPaths(paths: readonly NextPath[], context: NextPathContext): NextPath[] {
  const contextualEvidence: AgenticEvidenceRef[] = [];
  const add = (kind: "message" | "task" | "artifact", id: string | null | undefined, label: string) => {
    if (!id || !validEvidenceId(id)) return;
    if (contextualEvidence.some((evidence) => evidence.kind === kind && evidence.id === id)) return;
    contextualEvidence.push({ id, kind, label });
  };
  add("message", context.messageId, "Latest assistant response");
  add("task", context.taskId, "Linked task");
  for (const id of context.toolOutcomeIds ?? []) {
    add("artifact", id, "Recent tool outcome");
    if (contextualEvidence.length >= MAX_NEXT_PATH_EVIDENCE_REFS) break;
  }

  return paths.map((path) => {
    // Metadata IDs are model claims. Render only the bounded IDs supplied by
    // Chat, which are resolved independently of the trailer text.
    const evidenceRefs = [...contextualEvidence];
    if (!path.metadata && evidenceRefs.length === 0) return path;
    return {
      ...path,
      metadata: {
        rationale: path.metadata?.rationale ?? "Suggested from the latest assistant response.",
        evidenceRefs,
      },
    };
  });
}
