/**
 * Aggregate a pull request's CI signals into a single rollup status for the
 * GitHub view's per-PR status pip. Pure + dependency-free so it's unit-testable
 * without touching the network.
 *
 * NOTE: only the `failing` result is surfaced in the UI. `passing` / `pending`
 * are computed honestly here but not rendered, because repos with a perpetual
 * bot check (e.g. an always-in-progress reviewer) or "expected" required
 * contexts that never run will read as `pending` forever — so a green/amber pip
 * would mislead. A genuine `failure` conclusion, by contrast, only comes from a
 * real CI job that ran and failed, which is the reliable, actionable signal.
 */

export type CheckSummary = "passing" | "failing" | "pending" | null;

export type CheckRun = { status?: string | null; conclusion?: string | null };

// GitHub check-run conclusions that mean a real job ran and did not pass.
// "neutral", "skipped", "success", "cancelled", and "stale" are NOT treated as
// failures: cancelled/stale are usually superseded runs, not genuine breakage.
const FAIL_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

/**
 * Roll up GitHub Actions check-runs (preferred) with the legacy combined
 * commit-status state as a fallback:
 *   - `failing`  — at least one completed check-run failed.
 *   - `pending`  — no failure, but at least one check-run is still running.
 *   - `passing`  — at least one check-run, all completed, none failed.
 *   - `null`     — no CI signal at all.
 *
 * Failure takes precedence over pending: a PR with a failed check needs
 * attention even if other checks are still running.
 */
export function summarizeChecks(
  checkRuns: CheckRun[],
  combinedState?: string | null,
): CheckSummary {
  if (checkRuns.length > 0) {
    const failed = checkRuns.some((run) => FAIL_CONCLUSIONS.has(run.conclusion ?? ""));
    if (failed) return "failing";
    const pending = checkRuns.some((run) => run.status !== "completed");
    return pending ? "pending" : "passing";
  }

  switch (combinedState) {
    case "success":
      return "passing";
    case "failure":
    case "error":
      return "failing";
    case "pending":
      return "pending";
    default:
      return null;
  }
}
