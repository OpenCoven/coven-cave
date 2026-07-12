import {
  autoArchiveSessionsLocal,
  loadConfig,
  type CaveState,
} from "@/lib/cave-config";
import {
  autoArchiveDecisions,
  normalizeChatAutoArchivePolicy,
  type AutoArchiveSessionInput,
} from "@/lib/chat-auto-archive";
import { resolveArchiveNudges } from "@/lib/task-archive-nudge-emit";

/**
 * Server-side IO wiring for the chat auto-archive sweep. Pure decision logic
 * lives in `chat-auto-archive.ts`; this module reads the configured policy,
 * writes the batched archive timestamps into cave state, and resolves any
 * pending archive nudges for swept sessions. Best-effort throughout: a sweep
 * failure must never break the session list it piggybacks on.
 */

/**
 * Sweep `rows` against the configured auto-archive policy and archive the
 * sessions that are due. Returns sessionId → archivedAt for rows archived by
 * this call (empty when nothing was due or the sweep failed).
 */
export async function sweepAutoArchive(
  rows: AutoArchiveSessionInput[],
  state: CaveState,
  now: Date = new Date(),
): Promise<Map<string, string>> {
  try {
    const config = await loadConfig();
    const policy = normalizeChatAutoArchivePolicy(config.chatAutoArchive);
    const decisions = autoArchiveDecisions(rows, policy, {
      keep: state.sessionKeep,
      extendedUntil: state.sessionArchiveExtendedUntil,
      now,
    });
    if (decisions.length === 0) return new Map();
    const archived = await autoArchiveSessionsLocal(decisions.map((d) => d.sessionId));
    for (const sessionId of archived.keys()) {
      await resolveArchiveNudges(sessionId);
    }
    return archived;
  } catch {
    return new Map();
  }
}
