/**
 * Quote-reply helpers ("Reply to Chat").
 *
 * Cave persists a chat transcript server-side from the `prompt` sent to
 * /api/chat/send — the client's optimistic Turn objects are never written
 * back directly. So a reply that the model can actually see AND that survives
 * a reload must ride inside the prompt text itself, as a markdown blockquote,
 * rather than as a separate metadata field that would need plumbing through
 * the send route, the daemon conversation store, and the load mapping.
 *
 * These pure helpers build that quoted prefix; the composer prepends it to the
 * outgoing message at send time and clears the reply target.
 */

export type ReplyTarget = {
  /** The turn being replied to (kept for a future scroll-to-original link). */
  turnId: string;
  /** Display name of the quoted author ("You" for the user's own turns). */
  author: string;
  /** One-or-few-line excerpt of the quoted message, pre-condensed. */
  snippet: string;
};

/** Max characters kept in a reply snippet before ellipsizing. */
export const REPLY_SNIPPET_MAX = 200;

/**
 * Condense a turn's full text to a short, single-line snippet: collapse every
 * run of whitespace (including newlines and code fences) to one space, trim,
 * and truncate to `max` with an ellipsis. Keeps the composer chip and the
 * outgoing blockquote compact regardless of how long the quoted turn was.
 */
export function buildReplySnippet(text: string, max = REPLY_SNIPPET_MAX): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

/**
 * Build the outgoing prompt for a quote-reply: a markdown blockquote naming
 * the quoted author and excerpt, a blank line, then the user's reply body.
 * Returns `body` unchanged when there is no reply target so the normal send
 * path is a no-op pass-through.
 */
export function buildQuotedPrompt(target: ReplyTarget | null, body: string): string {
  if (!target) return body;
  const snippet = buildReplySnippet(target.snippet);
  const quoted = snippet
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const header = `> Replying to **${target.author}**:`;
  return `${header}\n${quoted}\n\n${body}`;
}
