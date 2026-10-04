import { normalizeToolActivity } from "./chat-activity.ts";
import type { ChatReasoningBlock } from "./chat-reasoning-blocks.ts";
import type { ToolEvent } from "./chat-turn-state.ts";
import { markdownCodeRanges } from "./github-blocks.ts";
import { segmentTurn } from "./turn-segments.ts";

type ActivityEntry =
  | { kind: "tool"; key: string; textOffset: number; sequence: number; tool: ToolEvent }
  | { kind: "reasoning"; key: string; textOffset: number; sequence: number; block: ChatReasoningBlock };
export type ChatTimelineEntry = ActivityEntry | { kind: "text"; key: string; text: string };

/** Layout protection only. The existing rich-card parsers still validate and
 * render every marker. Keeping a marker atomic never grants it authority. */
function timelineBoundaries(text: string) {
  const markers: Array<{ start: number; end: number; name: string; group?: string }> = [];
  const opener = /<coven:([a-zA-Z-]+)\b/g;
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    let quote = false;
    let end = text.length;
    for (let i = opener.lastIndex; i < text.length; i++) {
      if (text[i] === '"') quote = !quote;
      if (text[i] === ">" && !quote) { end = i + 1; break; }
    }
    const raw = text.slice(match.index, end);
    if (!raw.endsWith("/>")) {
      const close = `</coven:${match[1]}>`;
      const closeAt = text.indexOf(close, end);
      if (closeAt !== -1) end = closeAt + close.length;
    }
    markers.push({ start: match.index, end, name: match[1], group: /\bgroup="([^"]+)"/.exec(raw)?.[1] });
    opener.lastIndex = end;
  }
  // Attribute backticks must not influence Markdown's fence/code scanner.
  let masked = "";
  let cursor = 0;
  for (const marker of markers) {
    masked += text.slice(cursor, marker.start) + text.slice(marker.start, marker.end).replace(/[^\r\n]/g, " ");
    cursor = marker.end;
  }
  masked += text.slice(cursor);
  const codeRanges = markdownCodeRanges(masked);
  const atomicRanges: Array<[number, number]> = [
    ...codeRanges, ...markers.map(({ start, end }): [number, number] => [start, end]),
  ];
  // A grouped image deck and adjacent question/image markers are one card in
  // the existing pipeline. Do not divide them into independent render passes.
  const decks = new Map<string, [number, number]>();
  let previous: typeof markers[number] | undefined;
  for (const marker of markers) {
    if (codeRanges.some(([start, end]) => marker.start >= start && marker.start < end)) continue;
    if (marker.name === "image" && marker.group) {
      const deck = decks.get(marker.group);
      if (deck) deck[1] = marker.end;
      else decks.set(marker.group, [marker.start, marker.end]);
    }
    if ((marker.name === "image" || marker.name === "approve") && previous?.name === marker.name &&
      !text.slice(previous.end, marker.start).trim()) atomicRanges.push([previous.start, marker.end]);
    previous = marker;
  }
  atomicRanges.push(...decks.values());
  const boundaries = markers.flatMap(({ start, end }) => [start, end]);
  // Plain prose can end at a streamed newline without waiting for a second
  // blank line. Rich Markdown still uses segmentTurn's paragraph boundaries.
  let lineStart = 0;
  let plainParagraph = true;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue;
    const line = text.slice(lineStart, i + 1);
    plainParagraph &&= !/[`*_~<>[\]\\]|^\s*(?:[-+]\s|\d+[.)]\s|#{1,6}\s|>|\|)/m.test(line);
    if (plainParagraph) boundaries.push(i + 1);
    if (!line.trim()) plainParagraph = true;
    lineStart = i + 1;
  }
  return { boundaries, atomicRanges };
}

/** Stable per-observation siblings share the same parent while prose grows,
 * corrections move anchors, or a turn settles. Missing legacy positions keep
 * the existing layout; timestamps never manufacture an ordering. */
export function chatActivityTimeline(text: string, tools: readonly ToolEvent[] = [], reasoning: readonly ChatReasoningBlock[] = []): ChatTimelineEntry[] | null {
  const entries: ActivityEntry[] = [];
  const runs = new Set<string>();
  for (const tool of tools) {
    const activity = normalizeToolActivity(tool.activity, tool.id, tool.status);
    if (activity?.sequence === undefined || !Number.isSafeInteger(tool.textOffset) || tool.textOffset! < 0) return null;
    runs.add(activity.runId);
    entries.push({ kind: "tool", key: `tool:${tool.id}`, tool, sequence: activity.sequence, textOffset: tool.textOffset! });
  }
  for (const block of reasoning) {
    if (!Number.isSafeInteger(block.observation.sequence) || block.observation.sequence! < 0 || !Number.isSafeInteger(block.textOffset) || block.textOffset! < 0) return null;
    runs.add(block.observation.runId);
    entries.push({ kind: "reasoning", key: `reasoning:${block.id}`, block, sequence: block.observation.sequence!, textOffset: block.textOffset! });
  }
  if (!entries.length || runs.size !== 1 || new Set(entries.map((entry) => entry.sequence)).size !== entries.length ||
    new Set(entries.map((entry) => entry.key)).size !== entries.length) return null;
  entries.sort((a, b) => a.sequence - b.sequence);
  const segments = segmentTurn(text, entries, timelineBoundaries(text))!;
  const result: ChatTimelineEntry[] = [];
  let preceding = "start";
  for (const segment of segments) {
    if (segment.kind === "text") result.push({ kind: "text", key: `prose:${preceding}`, text: segment.text });
    else for (const entry of segment.tools) { result.push(entry); preceding = entry.key; }
  }
  return result;
}
