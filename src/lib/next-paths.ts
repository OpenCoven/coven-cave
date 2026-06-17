/**
 * "Next path" chat suggestions — the piggyback model: the agent is asked (via a
 * prompt directive) to end its reply with a parseable block of short next-step
 * suggestions; the chat transcript strips that block at render (like reasoning)
 * and surfaces the lines as clickable chips. No runtime LLM call — the
 * suggestions ride along on the normal turn.
 */

export const DEFAULT_NEXT_PATHS_COUNT = 3;

const OPEN = "<coven:next-paths>";
const CLOSE = "</coven:next-paths>";

/** Prompt directive instructing the agent to append the suggestions block. */
export function buildNextPathsDirective(count: number = DEFAULT_NEXT_PATHS_COUNT): string {
  if (count <= 0) return "";
  return [
    "<next_paths>",
    `After your reply, append up to ${count} short suggested next steps the user could take, as exactly this block:`,
    OPEN,
    "- first next step (imperative, <= ~7 words)",
    "- second next step",
    CLOSE,
    "One '- ' line each, distinct and directly useful. Put nothing after the closing tag.",
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
export function extractNextPaths(text: string): { visible: string; suggestions: string[] } {
  if (!text) return { visible: text, suggestions: [] };
  const open = text.lastIndexOf(OPEN);
  if (open === -1) return { visible: text, suggestions: [] };
  const closeAt = text.indexOf(CLOSE, open);
  const innerEnd = closeAt === -1 ? text.length : closeAt;
  const blockEnd = closeAt === -1 ? text.length : closeAt + CLOSE.length;
  const inner = text.slice(open + OPEN.length, innerEnd);
  const suggestions = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("first next step") && !l.startsWith("second next step"))
    .slice(0, 6);
  const visible = (text.slice(0, open) + text.slice(blockEnd)).replace(/\s+$/, "");
  return { visible, suggestions };
}
