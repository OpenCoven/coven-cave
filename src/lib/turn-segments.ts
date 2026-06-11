// CHAT-D4-01 — interleave tool calls at their chronological position.
//
// An assistant turn streams as text chunks interleaved with tool_use events,
// but the legacy display flattened that into "all text, then a trailing tool
// rollup" — tools that ran BEFORE a paragraph rendered AFTER it, inverting
// causality. The chat SSE handler now records, per tool, the length of the
// accumulated turn text at the moment the tool's FIRST event arrived
// (`textOffset`), and this module turns (text, tools-with-offsets) into an
// ordered list of display segments: prose spans and tool groups in arrival
// order.
//
// Splitting markdown at an arbitrary character offset is hazardous — a split
// inside a code fence breaks the fence and re-typesets everything after it.
// Offsets are therefore snapped FORWARD to the next paragraph boundary that
// sits OUTSIDE any code fence (the start of the line following a blank line,
// with ```/~~~ fence tracking), or to the end of the text when no such
// boundary follows yet. Tools that snap to the same boundary render as one
// consecutive group, preserving arrival order.
//
// Streaming stability falls out of the offset model: offsets are captured
// against text that only ever grows. A tool that arrives at a safe boundary can
// render before later prose immediately; a tool that arrives mid-paragraph
// floats at the end of the current text, so later text in that same paragraph
// can remain before the tool until the paragraph boundary streams in. Once a
// safe boundary exists, the tool anchors there permanently.
//
// Legacy compatibility (graceful degradation, NO transcript migration):
// stored transcripts predate `textOffset`. When there are no tools, or ANY
// tool lacks a finite offset, segmentTurn returns null and the caller keeps
// today's trailing-rollup rendering.

export type SegmentedTool = {
  /** Length of the turn text when this tool's first event arrived. */
  textOffset?: number;
};

export type TurnSegment<T extends SegmentedTool> =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: T[] };

/**
 * Offsets (into `text`) where the document can be split without landing
 * inside a code fence: the start of each line that follows a blank line,
 * computed with fence tracking (a blank line INSIDE a ```/~~~ fence is not a
 * paragraph boundary). A fence only closes on its own marker style, so a
 * ``` line inside a ~~~ block does not toggle state.
 */
function paragraphBreakpoints(text: string): number[] {
  const points: number[] = [];
  let pos = 0;
  let fence: "```" | "~~~" | null = null;
  let prevBlank = false;
  for (const line of text.split("\n")) {
    const lead = line.trimStart();
    const blank = lead.length === 0;
    // Boundary check uses the fence state BEFORE this line: splitting right
    // before a fence opener is safe.
    if (!fence && prevBlank && !blank) points.push(pos);
    const marker = lead.startsWith("```") ? "```" : lead.startsWith("~~~") ? "~~~" : null;
    if (marker && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null;
    }
    prevBlank = fence === null && blank;
    pos += line.length + 1;
  }
  return points;
}

/** Snap an offset forward to the next safe paragraph boundary, or text end. */
function snapOffset(offset: number, textLength: number, breakpoints: number[]): number {
  if (offset <= 0) return 0;
  if (offset >= textLength) return textLength;
  for (const bp of breakpoints) {
    if (bp >= offset) return bp;
  }
  return textLength;
}

/**
 * Assemble the ordered segment list for an assistant turn.
 *
 * Returns null when the turn cannot be segmented (no tools, or any tool
 * without a finite `textOffset`) — the caller renders the legacy layout.
 * Otherwise returns text spans and tool groups in chronological order;
 * whitespace-only spans are dropped, and the concatenation of the emitted
 * text spans plus dropped whitespace equals the input text (spans are
 * verbatim slices — markdown is never rewritten).
 */
export function segmentTurn<T extends SegmentedTool>(
  text: string,
  tools: readonly T[] | undefined,
): Array<TurnSegment<T>> | null {
  if (!tools || tools.length === 0) return null;
  if (!tools.every((t) => typeof t.textOffset === "number" && Number.isFinite(t.textOffset))) {
    return null;
  }
  const breakpoints = paragraphBreakpoints(text);
  // Stable sort: tools captured at the same boundary keep arrival order.
  const placed = tools
    .map((tool) => ({
      tool,
      at: snapOffset(tool.textOffset as number, text.length, breakpoints),
    }))
    .sort((a, b) => a.at - b.at);

  const segments: Array<TurnSegment<T>> = [];
  let cursor = 0;
  let i = 0;
  while (i < placed.length) {
    const at = placed[i].at;
    const group: T[] = [];
    while (i < placed.length && placed[i].at === at) {
      group.push(placed[i].tool);
      i += 1;
    }
    if (at > cursor) {
      const span = text.slice(cursor, at);
      if (span.trim()) segments.push({ kind: "text", text: span });
      cursor = at;
    }
    segments.push({ kind: "tools", tools: group });
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail.trim()) segments.push({ kind: "text", text: tail });
  }
  return segments;
}
