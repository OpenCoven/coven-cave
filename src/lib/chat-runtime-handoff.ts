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

/**
 * Identity of one handoff request. A turn captures this when it starts and
 * presents it again at persistence, so a marker written while that turn was in
 * flight is never consumed by a turn that did not run on its target. Two
 * markers sharing all three fields describe the same transition, so collapsing
 * them into one epoch cannot promote the wrong runtime.
 */
export function runtimeHandoffEpoch(
  handoff: PendingRuntimeHandoff | undefined,
): string | null {
  if (!handoff) return null;
  return [
    canonicalHarnessId(handoff.fromHarness),
    canonicalHarnessId(handoff.toHarness),
    handoff.requestedAt,
  ].join(" ");
}

/** A handoff never resumes the previous runtime's native session. */
export function resolveRuntimeHandoff(conversation: RuntimeHandoffConversation): {
  harness: string;
  startsFresh: boolean;
  handoffEpoch: string | null;
} {
  const pending = conversation.pendingRuntimeHandoff;
  if (pending) {
    return {
      harness: canonicalHarnessId(pending.toHarness),
      startsFresh: true,
      handoffEpoch: runtimeHandoffEpoch(pending),
    };
  }
  return {
    harness: canonicalHarnessId(conversation.harness),
    startsFresh: false,
    handoffEpoch: null,
  };
}
