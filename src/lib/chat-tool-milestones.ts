import type { ToolEvent } from "./chat-turn-state.ts";
import { toolStatusLabel, type ToolStatus } from "./chat-tool-state.ts";

/** Track semantic transitions, not argument/output chunks. Never read payloads
 * into the live region or replay settled history as newly executed work. */
export function createToolMilestoneTracker() {
  let turnId: string | undefined;
  let observedLive = false;
  const calls = new Map<string, { ordinal: number; status: ToolStatus }>();
  return (turn: { id: string; pending?: boolean; tools?: readonly ToolEvent[] } | undefined): string[] => {
    if (turn?.id !== turnId) {
      turnId = turn?.id;
      observedLive = false;
      calls.clear();
    }
    if (!turn || (!turn.pending && !observedLive)) return [];
    observedLive ||= Boolean(turn.pending);
    const messages: string[] = [];
    for (const tool of turn.tools ?? []) {
      const previous = calls.get(tool.id);
      const ordinal = previous?.ordinal ?? calls.size + 1;
      calls.set(tool.id, { ordinal, status: tool.status });
      if (previous?.status === tool.status) continue;
      // Ordinals distinguish parallel same-name calls without exposing input,
      // output, target paths, or unbounded producer-controlled names.
      messages.push(`Tool ${ordinal}: ${toolStatusLabel(tool.status).toLowerCase()}.`);
    }
    return messages;
  };
}
