/**
 * "Next path" chat suggestions — the piggyback model: the agent is asked (via a
 * prompt directive) to end its reply with a parseable block of short next-step
 * suggestions; the chat transcript strips that block at render (like reasoning)
 * and surfaces the lines as clickable chips. No runtime LLM call — the
 * suggestions ride along on the normal turn.
 */

export const DEFAULT_NEXT_PATHS_COUNT = 4;

const OPEN = "<coven:next-paths>";
const CLOSE = "</coven:next-paths>";

/** Prompt directive instructing the agent to append the suggestions block. */
export function buildNextPathsDirective(count: number = DEFAULT_NEXT_PATHS_COUNT): string {
  if (count <= 0) return "";
  // At the default count the ask is "2 or 4, never 3": a tight pair when only
  // a couple of steps are genuinely useful, a full spread when the moment is
  // rich. A fixed middle count made every turn's chip row read the same.
  const spread = count >= 4;
  return [
    "<next_paths>",
    `After your reply, append ${spread ? `2 or ${count}` : `up to ${count}`} short suggested next steps the user could take, as exactly this block:`,
    OPEN,
    "- first next step (imperative, <= ~7 words)",
    "- second next step",
    CLOSE,
    spread
      ? `One '- ' line each, distinct and directly useful. Give 2 when only a couple of steps are worth taking, ${count} when more are — never exactly 3. Put nothing after the closing tag.`
      : "One '- ' line each, distinct and directly useful. Put nothing after the closing tag.",
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
    // At most 4 pills ever render — the chip row's product cap (an over-eager
    // agent that lists more gets trimmed, not a fifth row).
    .slice(0, DEFAULT_NEXT_PATHS_COUNT);
  const visible = (text.slice(0, open) + text.slice(blockEnd)).replace(/\s+$/, "");
  return { visible, suggestions };
}
