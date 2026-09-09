import { flowSessionReferenceFor } from "../flow-session.ts";
import type { SessionRow } from "../types.ts";
import { finalizeFlowSession } from "./flow-attention.ts";
import { flowSessionTranscript } from "./flow-session-transcript.ts";
import { loadFlowSessionState } from "./flow-store.ts";

type OutcomeRow = Pick<SessionRow, "id" | "status" | "exit_code" | "updated_at"> & {
  familiarId?: string | null;
};

let nextOutcomeOffset = 0;

/** Retry exact terminal outcomes, including missed direct Copilot callbacks. */
export async function reconcileFlowSessionOutcomes(sessions: readonly OutcomeRow[]): Promise<void> {
  const state = await loadFlowSessionState(false);
  const outcomes = sessions.flatMap((session) => {
    if (!flowSessionReferenceFor(state.sessionFlow, session.id) ||
        !Object.hasOwn(state.sessionFlowCompleted ?? {}, session.id) ||
        state.sessionFlowCompleted?.[session.id] !== false) return [];
    const status = session.status.toLowerCase();
    const cancelled = ["cancelled", "canceled", "killed"].includes(status);
    const failed = ["failed", "error", "orphaned", "stopped", "dead"].includes(status);
    const completed = ["completed", "complete", "done", "exited"].includes(status);
    if (!cancelled && !failed && !completed) return [];
    return [{
      session, cancelled,
      isError: failed || (session.exit_code != null && session.exit_code !== 0),
    }];
  });
  // A first post-upgrade poll may contain hundreds of old runs. Bound PTY
  // hydration and rotate past unavailable transcripts so they cannot starve
  // later actionable outcomes. Advance before awaiting concurrent hydration.
  if (outcomes.length === 0) {
    nextOutcomeOffset = 0;
    return;
  }
  const offset = nextOutcomeOffset % outcomes.length;
  const batch = outcomes.slice(offset).concat(outcomes.slice(0, offset)).slice(0, 4);
  nextOutcomeOffset = (offset + batch.length) % outcomes.length;
  await Promise.all(batch.map(async ({ session, cancelled, isError }) => {
    try {
      await finalizeFlowSession({
        sessionId: session.id,
        familiarId: session.familiarId ?? undefined,
        isError,
        cancelled,
        finishedAt: session.updated_at,
        text: cancelled ? "" : await flowSessionTranscript(session.id, undefined, true),
      });
    } catch (error) {
      console.warn("[flow-sessions] Could not reconcile execution:", session.id, error);
    }
  }));
}
