import { markdownCodeRanges } from "./github-blocks.ts";

export type TurnResultState = "pending" | "running" | "passed" | "attention" | "failed";
export type TurnResult = {
  id: string;
  label: string;
  state: TurnResultState;
  source: "familiar" | "verified-event";
};

export const RESULT_ID_MAX = 128;
export const RESULT_LABEL_MAX = 256;

const RESULT_MARKER_START = "<coven:result";
const RESULT_STATES: ReadonlySet<TurnResultState> = new Set([
  "pending",
  "running",
  "passed",
  "attention",
  "failed",
]);
const MARKER_RE = /<coven:result\b((?:[^">]|"[^"]*")*?)\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

type ResultAttrName = "id" | "state" | "label";

export function extractChatResultMarkers(
  text: string,
  options: { pending?: boolean } = {},
): { visible: string; results: TurnResult[] } {
  if (!text || !text.includes("<coven:r")) return { visible: text, results: [] };

  const byId = new Map<string, TurnResult>();
  const codeRanges = resultMarkerAwareCodeRanges(text);
  MARKER_RE.lastIndex = 0;

  let visible = text.replace(MARKER_RE, (marker, rawAttrs: string, index: number) => {
    if (inRanges(codeRanges, index)) return marker;
    const parsed = parseResultMarker(rawAttrs ?? "");
    if (parsed) byId.set(parsed.id, parsed);
    return "";
  });

  visible = stripIncompleteResultTail(visible);
  const results = [...byId.values()];
  if (options.pending) return { visible, results };
  return { visible, results };
}

function parseResultMarker(rawAttrs: string): TurnResult | null {
  const attrs = new Map<ResultAttrName, string>();
  let cursor = 0;
  ATTR_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
    if (rawAttrs.slice(cursor, match.index).trim() !== "") return null;
    const name = match[1];
    if (!isResultAttrName(name) || attrs.has(name)) return null;
    attrs.set(name, match[2]);
    cursor = match.index + match[0].length;
  }

  if (rawAttrs.slice(cursor).trim() !== "" || attrs.size !== 3) return null;

  const id = attrs.get("id")?.trim() ?? "";
  const label = attrs.get("label")?.trim() ?? "";
  const state = attrs.get("state")?.trim() ?? "";
  if (!id || !label) return null;
  if (id.length > RESULT_ID_MAX || label.length > RESULT_LABEL_MAX) return null;
  if (!RESULT_STATES.has(state as TurnResultState)) return null;

  return { id, label, state: state as TurnResultState, source: "familiar" };
}

function stripIncompleteResultTail(text: string): string {
  const codeRanges = resultMarkerAwareCodeRanges(text);
  const tail = lastIndexOutsideRanges(text, "<coven:r", codeRanges);
  if (tail === -1) return text;

  const fragment = text.slice(tail);
  if (RESULT_MARKER_START.startsWith(fragment) || !hasUnquotedGt(fragment)) {
    return text.slice(0, tail);
  }
  return text;
}

function hasUnquotedGt(text: string): boolean {
  let inQuote = false;
  for (const char of text) {
    if (char === '"') inQuote = !inQuote;
    else if (char === ">" && !inQuote) return true;
  }
  return false;
}

function isResultAttrName(name: string): name is ResultAttrName {
  return name === "id" || name === "state" || name === "label";
}

function resultMarkerAwareCodeRanges(text: string): Array<[number, number]> {
  return markdownCodeRanges(maskCompleteResultMarkers(text));
}

function maskCompleteResultMarkers(text: string): string {
  MARKER_RE.lastIndex = 0;
  return text.replace(MARKER_RE, (marker) => maskMarker(marker));
}

function maskMarker(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function lastIndexOutsideRanges(
  text: string,
  token: string,
  ranges: Array<[number, number]>,
): number {
  let index = text.lastIndexOf(token);
  while (index !== -1 && inRanges(ranges, index)) {
    index = text.lastIndexOf(token, index - 1);
  }
  return index;
}
