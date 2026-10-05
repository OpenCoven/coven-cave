import { maskApproveMarkers } from "../approve-blocks.ts";
import { markdownCodeRanges } from "../github-blocks.ts";
import { toolTextCorrection } from "../chat-tool-events.ts";
import type { StreamEvent } from "../stream-events.ts";

const TAGS = ["<thinking>", "</thinking>", "<reasoning>", "</reasoning>"];

/** Legacy tags are not provider-designated summaries. Remove their content
 * while preserving literal code and all other answer bytes. A possible tag
 * suffix stays private until it is disambiguated, including at an interrupted
 * end. Hidden Markdown cannot change the parser state of the visible answer. */
export function projectLegacyAssistantText(source: string, streaming = false): string {
  if (!source.includes("<")) return source;
  const lastOpener = source.lastIndexOf("<");
  const pendingTag = streaming && TAGS.some((tag) => tag.startsWith(source.slice(lastOpener).toLowerCase()));
  if (!/<\/?(?:thinking|reasoning)>/i.test(source) && !pendingTag) return source;
  const scannable = maskApproveMarkers(source);
  const tags = /<(\/?)(thinking|reasoning)>/gi;
  const active: string[] = [];
  let visible = "";
  let cursor = 0;
  let contextStart = 0;
  let contextPrefixLength = 0;
  let contextText = scannable;
  let code = markdownCodeRanges(contextText);
  const inCode = (index: number) => {
    const offset = contextPrefixLength + index - contextStart;
    return code.some(([start, end]) => offset >= start && offset < end);
  };
  for (let match = tags.exec(scannable); match; match = tags.exec(scannable)) {
    const contextOffset = contextPrefixLength + match.index - contextStart;
    if (!active.length && (inCode(match.index) || contextText.slice(contextOffset, contextOffset + match[0].length).toLowerCase() !== match[0].toLowerCase())) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (!active.length) {
      visible += source.slice(cursor, match.index);
      cursor = tags.lastIndex;
      if (!closing) active.push(name);
    } else if (!closing) {
      active.push(name);
    } else if (active.at(-1) === name) {
      active.pop();
      if (!active.length) {
        cursor = tags.lastIndex;
        contextStart = cursor;
        contextPrefixLength = visible.length;
        contextText = maskApproveMarkers(visible + source.slice(cursor));
        code = markdownCodeRanges(contextText);
      }
    }
  }
  if (active.length) return visible;
  let end = source.length;
  if (streaming) {
    const possibleTag = scannable.lastIndexOf("<");
    if (possibleTag >= cursor && !inCode(possibleTag) &&
      TAGS.some((tag) => tag.startsWith(scannable.slice(possibleTag).toLowerCase()))) end = possibleTag;
  }
  return visible + source.slice(cursor, end);
}

/** One emitter per turn, placed BEFORE SSE serialization and replay retention.
 * Native full-message corrections replace the private source, never append it.
 * Offsets in replacement events are recomputed against displayed text. */
export class LegacyReasoningStreamProjection {
  private source = "";
  private visible = "";
  private interrupted = false;

  interrupt(): void { this.interrupted = true; }

  project(event: StreamEvent): StreamEvent[] {
    if (event.kind === "reasoning" && event.block.textOffset !== undefined) {
      const [block] = projectLegacyToolOffsets([event.block], this.source);
      return [{ ...event, block }];
    }
    if (event.kind !== "assistant_chunk" && event.kind !== "assistant_replace" && event.kind !== "done") return [event];
    if (event.kind === "assistant_replace") {
      this.source = event.text;
      this.interrupted = false;
    }
    else if (event.kind === "assistant_chunk") this.source += event.text;
    const next = projectLegacyAssistantText(this.source, event.kind !== "done" || event.isError === true || this.interrupted);
    const events: StreamEvent[] = [];
    if (event.kind === "assistant_replace" || !next.startsWith(this.visible)) {
      const correction = toolTextCorrection(this.visible, next);
      events.push({ kind: "assistant_replace", text: next, ...(correction ? { toolOffsetCorrection: correction } : {}) });
    } else if (next.length > this.visible.length) {
      events.push({ kind: "assistant_chunk", text: next.slice(this.visible.length) });
    }
    this.visible = next;
    if (event.kind === "done") events.push(event);
    return events;
  }
}

/** Tool and reasoning offsets refer to native answer UTF-16 positions; clients only see the projected
 * answer. Run before existing leading-whitespace/attachment offset handling. */
export function projectLegacyToolOffsets<T extends { textOffset?: number }>(tools: T[], text: string): T[] {
  const offsets = new Map<number, number>();
  const projectedOffset = (offset: number) => {
    const previous = offsets.get(offset);
    if (previous !== undefined) return previous;
    const projected = projectLegacyAssistantText(text.slice(0, offset), true).length;
    offsets.set(offset, projected);
    return projected;
  };
  return tools.map((tool) => typeof tool.textOffset === "number"
    ? { ...tool, textOffset: projectedOffset(tool.textOffset) }
    : tool);
}
