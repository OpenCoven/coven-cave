import { markdownCodeRanges } from "./github-blocks.ts";

/**
 * Split assistant text into its visible body and hidden reasoning blocks.
 * Unclosed blocks stay hidden while a response is streaming.
 */
export function splitReasoning(text: string): { visible: string; reasoning: string } {
  const reasoningParts: string[] = [];
  const visibleParts: string[] = [];
  const tagRe = /<(\/?)(thinking|reasoning)>/gi;
  const codeRanges = markdownCodeRanges(text);
  let activeTag: string | null = null;
  let reasoningStart = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(text)) !== null) {
    const matchIndex = match.index;
    if (codeRanges.some(([start, end]) => matchIndex >= start && matchIndex < end)) continue;
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (!activeTag && closing) {
      visibleParts.push(text.slice(cursor, match.index));
      cursor = tagRe.lastIndex;
      continue;
    }

    if (!activeTag && !closing) {
      visibleParts.push(text.slice(cursor, match.index));
      activeTag = tag;
      reasoningStart = tagRe.lastIndex;
      cursor = tagRe.lastIndex;
      continue;
    }

    if (activeTag === tag && closing) {
      reasoningParts.push(text.slice(reasoningStart, match.index).trim());
      activeTag = null;
      cursor = tagRe.lastIndex;
    }
  }

  if (activeTag) {
    reasoningParts.push(text.slice(reasoningStart).trim());
  } else {
    visibleParts.push(text.slice(cursor));
  }

  const visible = visibleParts.join("");
  const DEBUG_PREFIX_RE = /^\[[a-z][\w-]*(?:\/[\w-]+)+\][^\n]*\n?/gim;
  return {
    visible: visible.replace(DEBUG_PREFIX_RE, "").replace(/\n{3,}/g, "\n\n").trimStart(),
    reasoning: reasoningParts.join("\n\n").trim(),
  };
}
