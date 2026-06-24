/**
 * Shapes the `/api/sessions/prune` success response body. Both the
 * daemon-native path and the client-side fallback funnel through here so the
 * dry-run-vs-real contract is single-sourced:
 *
 *   - dry run  → the count goes under `wouldPrune`, with `pruned: 0`
 *   - real run → deletions go under `pruned`
 *
 * The Maintenance "Check" UI (onboarding overlay) reads `wouldPrune` to decide
 * whether to offer the Delete button. Returning the dry-run count under
 * `pruned` instead silently left `wouldPrune` undefined → "Nothing to prune" →
 * no Delete button, so a prune could never run. That regression (the
 * daemon-native branch) shipped before this helper existed; keeping the shape
 * in one place is what stops it recurring on the next path that's added.
 */
export type PruneMethod = "daemon" | "client";

export type PruneResponseBody =
  | { ok: true; pruned: 0; wouldPrune: number; dryRun: true; method: PruneMethod }
  | { ok: true; pruned: number; method: PruneMethod };

export function prunePayload(opts: {
  dryRun: boolean;
  count: number;
  method: PruneMethod;
}): PruneResponseBody {
  const { dryRun, count, method } = opts;
  return dryRun
    ? { ok: true, pruned: 0, wouldPrune: count, dryRun: true, method }
    : { ok: true, pruned: count, method };
}
