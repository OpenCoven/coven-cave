import { canonicalHarnessId } from "./harness-adapters.ts";

export type PendingRuntimeHandoff = {
  fromHarness: string;
  toHarness: string;
  requestedAt: string;
};

type RuntimeHandoffConversation = {
  harness: string;
  pendingRuntimeHandoff?: PendingRuntimeHandoff;
};

/** A handoff never resumes the previous runtime's native session. */
export function resolveRuntimeHandoff(conversation: RuntimeHandoffConversation): {
  harness: string;
  startsFresh: boolean;
} {
  const pending = conversation.pendingRuntimeHandoff;
  if (pending) {
    return { harness: canonicalHarnessId(pending.toHarness), startsFresh: true };
  }
  return { harness: canonicalHarnessId(conversation.harness), startsFresh: false };
}
