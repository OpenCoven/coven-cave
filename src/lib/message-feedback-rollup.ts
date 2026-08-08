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

export type MessageFeedbackRollupOptions = {
  familiarId?: string;
  bucketLimit?: number;
};

function bump(map: Map<string, { up: number; down: number }>, key: string, vote: "up" | "down") {
  const stat = map.get(key) ?? { up: 0, down: 0 };
  stat[vote] += 1;
  map.set(key, stat);
}

function clampBucketLimit(limit: number | undefined): number | null {
  if (limit === undefined) return null;
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.floor(limit));
}

function toSlices(
  map: Map<string, { up: number; down: number }>,
  bucketLimit?: number,
): FeedbackSliceStat[] {
  const slices = Array.from(map.entries())
    .map(([key, { up, down }]) => ({
      key,
      up,
      down,
      total: up + down,
      approval: up + down > 0 ? up / (up + down) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const limit = clampBucketLimit(bucketLimit);
  return limit === null ? slices : slices.slice(0, limit);
}

export function applyMessageFeedbackEntry(
  finalVotes: Map<string, FeedbackRollupEntry>,
  entry: unknown,
  opts?: Pick<MessageFeedbackRollupOptions, "familiarId">,
): void {
  if (!entry || typeof entry !== "object") return;
  const candidate = entry as FeedbackRollupEntry;
  if (typeof candidate.messageId !== "string" || !candidate.messageId) return;
  if (candidate.vote !== "up" && candidate.vote !== "down") return;
  if (opts?.familiarId && candidate.familiarId !== opts.familiarId) return;
  if (candidate.cleared) finalVotes.delete(candidate.messageId);
  else finalVotes.set(candidate.messageId, candidate);
}

export function finalizeMessageFeedbackRollup(
  finalVotes: Iterable<FeedbackRollupEntry>,
  opts?: Pick<MessageFeedbackRollupOptions, "bucketLimit">,
): MessageFeedbackRollup {
  const bucketLimit = opts?.bucketLimit;
  let up = 0;
  let down = 0;
  const models = new Map<string, { up: number; down: number }>();
  const runtimes = new Map<string, { up: number; down: number }>();
  for (const entry of finalVotes) {
    if (entry.vote === "up") up += 1;
    else down += 1;
    if (entry.model) bump(models, entry.model, entry.vote);
    if (entry.runtime) bump(runtimes, entry.runtime, entry.vote);
  }

  return {
    up,
    down,
    total: up + down,
    models: toSlices(models, bucketLimit),
    runtimes: toSlices(runtimes, bucketLimit),
  };
}

export function rollupMessageFeedback(
  entries: FeedbackRollupEntry[],
  opts?: MessageFeedbackRollupOptions,
): MessageFeedbackRollup {
  // Replay the append-only log: the newest entry per message wins, and a
  // toggle-off (cleared) withdraws the vote entirely.
  const finalVotes = new Map<string, FeedbackRollupEntry>();
  for (const entry of entries) {
    applyMessageFeedbackEntry(finalVotes, entry, opts);
  }
  return finalizeMessageFeedbackRollup(finalVotes.values(), opts);
}
