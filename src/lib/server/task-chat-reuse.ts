/**
 * Reopening a task chat whose first prompt never landed (#6562 slice 2).
 *
 * A native Chat task reservation records a session id on the card, and the
 * work view sends the task's first prompt. If that view closed before the
 * send, or the send failed before anything was written, the session is
 * reserved but empty, and reopening the task used to show an empty chat. These
 * helpers let the board chat route decide, on reuse, whether to hand the
 * prompt back.
 *
 * A prompt is handed back only when nothing could have been sent:
 * - the route itself reserved this session as native Chat (the card's
 *   `nativeSessionId` names it), so it was never a daemon session that has
 *   its prompt and was later pruned;
 * - no run is in flight and no transcript was ever written;
 * - no other view was handed the same prompt in the last two minutes, so a
 *   second window or a quick reopen can't send it twice.
 * Any doubt keeps the old behaviour of reopening without a prompt.
 */

import { conversationFileExists, loadConversation } from "@/lib/cave-conversations";
import { cleanModelId } from "@/lib/chat-model-state";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { isModelAllowedByRuntime } from "@/lib/runtime-models";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";

/** A handed-out first prompt holds its session this long before it may be handed out again. */
export const FIRST_PROMPT_CLAIM_MS = 2 * 60 * 1000;

const claims = new Map<string, number>();

/**
 * Claim the right to hand out a session's first prompt. False while another
 * claim from the last `FIRST_PROMPT_CLAIM_MS` stands. A fresh reservation
 * claims too, so reopening right after a start can't hand the prompt out
 * twice. In-process only: one Cave server owns a task's launch.
 */
export function claimFirstPromptHandoff(sessionId: string, nowMs = Date.now()): boolean {
  const claimedAt = claims.get(sessionId);
  if (claimedAt !== undefined && nowMs - claimedAt < FIRST_PROMPT_CLAIM_MS) return false;
  if (claims.size > 512) {
    for (const [key, at] of claims) if (nowMs - at >= FIRST_PROMPT_CLAIM_MS) claims.delete(key);
  }
  claims.set(sessionId, nowMs);
  return true;
}

/** Test seam. */
export function resetFirstPromptClaimsForTest(): void {
  claims.clear();
}

export type FirstPromptProbeDeps = {
  hasActiveChatRun: (sessionId: string) => boolean;
  /** `undefined` = never written; `null` = present but unreadable. */
  loadTranscript: (sessionId: string) => Promise<{ turns: Array<{ role: string }> } | null | undefined>;
  claim: (sessionId: string) => boolean;
};

const defaultDeps: FirstPromptProbeDeps = {
  hasActiveChatRun,
  loadTranscript: async (sessionId) => {
    try {
      const conversation = await loadConversation(sessionId);
      if (conversation) return { turns: conversation.turns };
      return (await conversationFileExists(sessionId)) ? null : undefined;
    } catch {
      return null;
    }
  },
  claim: (sessionId) => claimFirstPromptHandoff(sessionId),
};

/** Whether a reused task session is still waiting for its first prompt. */
export async function reservedFirstPromptPending(
  card: { sessionId: string | null; nativeSessionId?: string | null },
  deps: FirstPromptProbeDeps = defaultDeps,
): Promise<boolean> {
  const sessionId = card.sessionId;
  if (!sessionId || card.nativeSessionId !== sessionId) return false;
  if (deps.hasActiveChatRun(sessionId)) return false;
  // Any transcript means a send started; its own retry path owns the rest.
  if ((await deps.loadTranscript(sessionId)) !== undefined) return false;
  return deps.claim(sessionId);
}

/**
 * The card's model override for the reopened first send, under the same rule
 * as a fresh launch: chosen for this exact runtime, a safe id, and allowed by
 * it. Anything else is dropped rather than refusing the reopen.
 */
export function validReuseModelOverride(
  card: { modelOverride?: string | null; modelOverrideHarness?: string | null },
  harness: string,
): string | null {
  if (!card.modelOverride || !card.modelOverrideHarness) return null;
  if (canonicalHarnessId(card.modelOverrideHarness) !== harness) return null;
  const model = cleanModelId(card.modelOverride);
  if (!model || !isModelAllowedByRuntime(harness, model)) return null;
  return model;
}
