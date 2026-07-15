/**
 * Pure rollup of per-message thumbs feedback into model / runtime performance
 * aggregates for the familiar analytics surface.
 *
 * The store (message-feedback-store.ts) is append-only: a re-vote appends a
 * new entry and a toggle-off appends `cleared: true`. The rollup replays the
 * log per messageId (last entry wins; cleared removes the vote) so counts
 * reflect the user's FINAL verdict on each message, then buckets the surviving
 * votes by the model and runtime that produced the response.
 *
 * Aggregate-only by design (privacy): consumers receive counts, never message
 * ids, timestamps, or content. Pure and unit-tested
 * (message-feedback-rollup.test.ts).
 */

export type FeedbackRollupEntry = {
  messageId: string;
  vote: "up" | "down";
  cleared: boolean;
  familiarId?: string;
  model?: string;
  runtime?: string;
};

/** Up/down counts for one model or runtime bucket. */
export type FeedbackSliceStat = {
  key: string;
  up: number;
  down: number;
  total: number;
  /** up / total, 0..1 (0 when the bucket is empty). */
  approval: number;
};

export type MessageFeedbackRollup = {
  up: number;
  down: number;
  total: number;
  /** Per-model buckets, most-voted first. Votes without a model stamp are omitted. */
  models: FeedbackSliceStat[];
  /** Per-runtime buckets, most-voted first. Votes without a runtime stamp are omitted. */
  runtimes: FeedbackSliceStat[];
};

export const EMPTY_FEEDBACK_ROLLUP: MessageFeedbackRollup = {
  up: 0,
  down: 0,
  total: 0,
  models: [],
  runtimes: [],
};

function bump(map: Map<string, { up: number; down: number }>, key: string, vote: "up" | "down") {
  const stat = map.get(key) ?? { up: 0, down: 0 };
  stat[vote] += 1;
  map.set(key, stat);
}

function toSlices(map: Map<string, { up: number; down: number }>): FeedbackSliceStat[] {
  return Array.from(map.entries())
    .map(([key, { up, down }]) => ({
      key,
      up,
      down,
      total: up + down,
      approval: up + down > 0 ? up / (up + down) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function rollupMessageFeedback(
  entries: FeedbackRollupEntry[],
  opts?: { familiarId?: string },
): MessageFeedbackRollup {
  // Replay the append-only log: the newest entry per message wins, and a
  // toggle-off (cleared) withdraws the vote entirely.
  const finalVotes = new Map<string, FeedbackRollupEntry>();
  for (const entry of entries) {
    if (!entry || typeof entry.messageId !== "string" || !entry.messageId) continue;
    if (entry.vote !== "up" && entry.vote !== "down") continue;
    if (opts?.familiarId && entry.familiarId !== opts.familiarId) continue;
    if (entry.cleared) finalVotes.delete(entry.messageId);
    else finalVotes.set(entry.messageId, entry);
  }

  let up = 0;
  let down = 0;
  const models = new Map<string, { up: number; down: number }>();
  const runtimes = new Map<string, { up: number; down: number }>();
  for (const entry of finalVotes.values()) {
    if (entry.vote === "up") up += 1;
    else down += 1;
    if (entry.model) bump(models, entry.model, entry.vote);
    if (entry.runtime) bump(runtimes, entry.runtime, entry.vote);
  }

  return {
    up,
    down,
    total: up + down,
    models: toSlices(models),
    runtimes: toSlices(runtimes),
  };
}
