import {
  archiveSessionsForMergedPrs,
  autoArchiveSessionsLocal,
  loadConfig,
  type CaveState,
} from "@/lib/cave-config";
import {
  autoArchiveDecisions,
  normalizeChatAutoArchivePolicy,
  type AutoArchiveSessionInput,
} from "@/lib/chat-auto-archive";
import {
  MERGED_AUTO_ARCHIVE_DISABLE_ENV,
  mergedChatAutoArchiveDecisions,
  type MergedAutoArchiveRow,
} from "@/lib/merged-chat-auto-archive";
import { resolveArchiveNudges } from "@/lib/task-archive-nudge-emit";

/**
 * Server-side IO wiring for the chat auto-archive sweeps — the policy sweep
 * (idle/external/etc.) and the merged-PR sweep. Pure decision logic lives in
 * `chat-auto-archive.ts` / `merged-chat-auto-archive.ts`; this module reads
 * the configured policy and cave state, writes the batched archive timestamps
 * into cave state, and resolves any pending archive nudges for swept
 * sessions. Best-effort throughout: a sweep failure must never break the
 * session list it piggybacks on.
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

/**
 * Sweep `rows` whose pull request has merged and archive them, recording each
 * (session, PR) pair in cave state so the sweep is one-shot — summoning the
 * chat later won't be undone by the next poll. Gated by the configured policy
 * (master switch + the `archiveOnPrMerge` toggle in the chat Settings tab)
 * and the env kill-switch (COVEN_CAVE_NO_MERGED_AUTO_ARCHIVE=1); shares the
 * policy sweep's opt-outs (keep marks, extension windows / summon grace).
 * Returns sessionId → archivedAt for rows archived by this call (empty when
 * nothing was due or the sweep failed).
 */
export async function sweepMergedPrAutoArchive(
  rows: MergedAutoArchiveRow[],
  state: CaveState,
  now: Date = new Date(),
): Promise<Map<string, string>> {
  try {
    if (process.env[MERGED_AUTO_ARCHIVE_DISABLE_ENV] === "1") return new Map();
    const config = await loadConfig();
    const policy = normalizeChatAutoArchivePolicy(config.chatAutoArchive);
    if (!policy.enabled || !policy.archiveOnPrMerge) return new Map();
    const decisions = mergedChatAutoArchiveDecisions(
      rows,
      state.mergedPrAutoArchived ?? {},
      {
        keep: state.sessionKeep ?? {},
        extendedUntil: state.sessionArchiveExtendedUntil ?? {},
        now,
      },
    );
    if (decisions.length === 0) return new Map();
    const archivedAt = await archiveSessionsForMergedPrs(decisions);
    const archived = new Map<string, string>();
    for (const { sessionId } of decisions) {
      archived.set(sessionId, archivedAt);
      await resolveArchiveNudges(sessionId);
    }
    return archived;
  } catch {
    return new Map();
  }
}
