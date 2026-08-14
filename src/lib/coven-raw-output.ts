/**
 * Unrecognized structured output (design proposal §10).
 *
 * Recognized `<coven:…>` blocks become components. Anything else the model
 * emits in that grammar — a tag this build does not know, or one truncated by
 * a dropped stream — is currently cut out of the visible reply and silently
 * discarded, so a reader cannot tell whether something was lost or the reply
 * simply ended there.
 *
 * This names the leftovers so they can be shown as a warning-toned disclosure
 * with the raw text inside, rather than either leaking as prose or vanishing.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

/**
 * Control blocks this build parses into components. A tag NOT in this set is
 * what the disclosure exists to surface — keep it in step with the extractors
 * in `next-paths.ts`, `group-chat.ts` and `chat-attention-stream.ts`.
 */
const RECOGNIZED_COVEN_TAGS = new Set([
  "next-paths",
  "delegation",
  "attention",
  "auto-status",
  "github-action",
  "image",
  "skill",
]);

const TAG_RE = /<\/?coven:([a-z0-9-]*)/gi;

function inFence(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Return the raw text of any unrecognized `coven:` control markup in a reply.
 *
 * Fenced code is exempt: a reply *documenting* the protocol is prose about a
 * tag, not an emission of one.
 */
export function unrecognizedCovenBlocks(text: string): string[] {
  if (!text || !text.includes("<coven:") && !text.includes("</coven:")) return [];
  const ranges = markdownCodeRanges(text);
  const found: string[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    const index = match.index ?? 0;
    if (inFence(ranges, index)) continue;
    const name = (match[1] ?? "").toLowerCase();
    // A truncated tag ("<coven:next-pa") is unrecognized by definition: the
    // name is a prefix of a known one but is not that name.
    if (RECOGNIZED_COVEN_TAGS.has(name)) continue;
    // Capture through the end of the tag, or to the end of the line when the
    // stream cut mid-tag and there is no closing bracket to find.
    const close = text.indexOf(">", index);
    const newline = text.indexOf("\n", index);
    const end =
      close !== -1 && (newline === -1 || close < newline)
        ? close + 1
        : newline === -1
          ? text.length
          : newline;
    const raw = text.slice(index, end).trim();
    if (raw && !found.includes(raw)) found.push(raw);
  }
  return found;
}
