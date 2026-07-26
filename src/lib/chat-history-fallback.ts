/**
 * Fallback conversation context for the chat/send route.
 *
 * The normal path keeps the model's memory by passing `--continue
 * <harnessSessionId>` so the harness reconstructs history from its own rollout
 * store — the prompt itself carries only the new message. That breaks when the
 * harness reports its resume failed (rollout DB rotated/cleared, session locked
 * by another process, or "not found in local store"): the route then transparently
 * retries WITHOUT `--continue`, which starts a brand-new harness session with
 * ZERO history. The familiar loses the thread mid-conversation and the user has
 * to remind it of what was already said.
 *
 * This module rebuilds a compact transcript of the active conversation path so
 * the fresh-session retry can be primed with recent context instead of starting
 * blank. It is pure (no I/O) so it can be unit-tested in isolation.
 */
import type { ChatTurn, ConversationFile } from "./cave-conversations.ts";
import { resolveActivePath } from "./conversation-tree.ts";

/** Last N user/assistant turns to replay (~6 exchanges). Bounded so a long
 *  thread doesn't blow the prompt budget — the active tail is what matters for
 *  continuity. */
export const MAX_FALLBACK_HISTORY_TURNS = 12;

/** Per-turn character cap. A single pasted wall of text (a stack trace, a whole
 *  file) replayed verbatim could dominate or blow the prompt budget; clamp each
 *  replayed turn so the block stays bounded (~12 turns × this) regardless of how
 *  large any one historical message was. Generous enough to preserve the gist. */
export const MAX_FALLBACK_CHARS_PER_TURN = 4000;

const TRUNCATION_MARKER = "… (truncated)";

type ConversationHistorySource = Pick<ConversationFile, "turns" | "activeLeafId">;

function clampTurnText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (maxChars <= 0 || trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Render a "Prior conversation" markdown block from the most recent user and
 * assistant turns along the active path. Returns "" when there is nothing
 * usable to replay (no turns, only system/empty/errored turns). The caller is
 * expected to load the conversation BEFORE appending the current turn, so the
 * returned block never includes the message being sent.
 */
export function buildPriorConversationBlock(
  conversation: ConversationHistorySource | null | undefined,
  opts: { maxTurns?: number; maxCharsPerTurn?: number } = {},
): string {
  if (!conversation?.turns?.length) return "";
  const maxTurns = opts.maxTurns ?? MAX_FALLBACK_HISTORY_TURNS;
  const maxCharsPerTurn = opts.maxCharsPerTurn ?? MAX_FALLBACK_CHARS_PER_TURN;
  const path = resolveActivePath(conversation.turns, conversation.activeLeafId ?? "");
  const usable = path.filter(
    (t: ChatTurn) =>
      (t.role === "user" || t.role === "assistant") &&
      !t.isError &&
      t.text.trim().length > 0,
  );
  const windowed = usable.slice(-maxTurns);
  if (windowed.length === 0) return "";
  const lines = windowed.map((t) => {
    const label = t.role === "user" ? "User" : "Assistant";
    return `**${label}:** ${clampTurnText(t.text, maxCharsPerTurn)}`;
  });
  return ["## Prior conversation", "", ...lines].join("\n");
}

/**
 * Prepend a prior-conversation block to a harness prompt, separated by a rule so
 * the model can tell the replayed history from the live instruction. A no-op
 * when the block is empty.
 */
export function prependPriorConversation(prompt: string, block: string): string {
  if (!block) return prompt;
  return `${block}\n\n---\n\n${prompt}`;
}

/**
 * The exact prompt transformation the chat/send route applies when a harness
 * resume fails and it has to fork a fresh session: replay recent history (if
 * any) into the prompt so the new session keeps context. Returns the prompt to
 * spawn with plus whether history was actually replayed (so the caller can
 * reflect it in the progress timeline). Keeping this as one pure function lets
 * the route's fallback behaviour be unit-tested without spawning a harness.
 */
export function buildResumeRetryPrompt(
  harnessPrompt: string,
  conversation: ConversationHistorySource | null | undefined,
  opts: { maxTurns?: number; maxCharsPerTurn?: number } = {},
): { prompt: string; replayedHistory: boolean } {
  const block = buildPriorConversationBlock(conversation, opts);
  return {
    prompt: prependPriorConversation(harnessPrompt, block),
    replayedHistory: block.length > 0,
  };
}
