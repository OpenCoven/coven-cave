// Reply recommendation (quick chat): after a familiar replies, propose the
// single most useful next message the *user* could send — a natural follow-up
// or a concrete next-step directive — so it can be Tab-accepted straight into
// the composer. These helpers are pure (no React, no imports) so the hook and
// tests can exercise the protocol directly, mirroring prompt-enhancer.ts.

/** The minimal shape a turn needs for a recommendation. QuickChatMessage
 *  satisfies this structurally, so the hook passes its messages as-is without
 *  coupling this pure module to the client hook. */
export type RecommendationTurn = {
  role: "user" | "assistant";
  text: string;
  /** An assistant turn still streaming in — not yet a valid anchor. */
  pending?: boolean;
  /** Local note (slash-command output) — assistant-styled but not a familiar
   *  reply, so never a recommendation anchor. */
  local?: boolean;
};

const OPEN = "<reply>";
const CLOSE = "</reply>";

// How many trailing turns to include, and the per-message character cap — the
// recommendation only needs the recent arc, not the whole thread.
const MAX_TURNS = 6;
const MAX_CHARS = 600;

function clip(text: string, max = MAX_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** A recommendation only makes sense once a familiar has actually replied — a
 *  cold thread (or one waiting on a reply) has nothing to build a next move on. */
export function hasReplyableTurn(messages: RecommendationTurn[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.pending || last.local) return false;
  return last.text.trim().length > 0;
}

/** The meta-prompt sent to the familiar. It must propose the user's next
 *  message — never continue as the assistant — and return only that message
 *  inside <reply> tags so streaming extraction has an unambiguous frame. */
export function buildRecommendationInstruction({
  messages,
  familiarName,
}: {
  messages: RecommendationTurn[];
  familiarName?: string | null;
}): string {
  const speaker = familiarName?.trim() || "Familiar";
  const recent = messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-MAX_TURNS)
    .map((m) => `${m.role === "user" ? "User" : speaker}: ${clip(m.text)}`)
    .join("\n");
  return [
    "You are helping the User decide what to send next in this conversation.",
    "Propose the single most useful next message the User could send — either a natural follow-up reply or a concrete next-step directive.",
    "Rules: write it in the User's first-person voice, ready to send as-is. Keep it to one or two sentences. Do not answer as the assistant, do not add commentary, do not address the User, do not wrap it in quotes.",
    "Return ONLY the suggested message wrapped exactly in <reply></reply> tags — no preamble.",
    "",
    "Conversation so far:",
    recent,
  ].join("\n");
}

/** Streaming-safe extraction of the suggested reply. Mirrors
 *  extractEnhancedPrompt: trims a trailing partial of the closing tag mid-stream
 *  so it never flashes tag noise, falls back to the whole trimmed text when the
 *  model ignores the wrapper, and strips a stray wrapping quote. */
export function extractRecommendedReply(text: string): { partial: string; complete: boolean } {
  const open = text.indexOf(OPEN);
  if (open >= 0) {
    const start = open + OPEN.length;
    const close = text.indexOf(CLOSE, start);
    if (close >= 0) return { partial: unquote(text.slice(start, close).trim()), complete: true };
    // Mid-stream: drop a trailing partial of the closing tag (longest suffix of
    // the body that is a prefix of "</reply>") so it never renders.
    let body = text.slice(start);
    for (let n = Math.min(CLOSE.length - 1, body.length); n > 0; n -= 1) {
      if (body.endsWith(CLOSE.slice(0, n))) {
        body = body.slice(0, body.length - n);
        break;
      }
    }
    return { partial: body.trimStart(), complete: false };
  }
  // No opening tag yet. If everything so far could still become the tag (a
  // prefix of it, ignoring leading whitespace), show nothing.
  const lead = text.trimStart();
  if (lead.length < OPEN.length && OPEN.startsWith(lead)) return { partial: "", complete: false };
  // A tagless stream is usable as-is once trimmed of stray code fences.
  const cleaned = lead
    .trim()
    .replace(/^```[a-z]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return { partial: unquote(cleaned), complete: false };
}

/** Models occasionally wrap the suggestion in matching quotes despite the rule
 *  — strip a single balanced pair so the draft doesn't inherit them. */
function unquote(text: string): string {
  const m = /^(["'“”‘’])([\s\S]*)\1$/.exec(text);
  return m ? m[2].trim() : text;
}
