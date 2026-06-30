import type { AutomationRunStatus } from "@/lib/automation-runs";

/**
 * Shared run-status → CSS-color-var mapping for the Automations surface, so the
 * recent-runs list and the row last-run badge can't drift apart.
 *
 * `quietSuccess` is the one intentional difference between the two callers: the
 * recent-runs list highlights a succeeded run (accent) to distinguish outcomes,
 * while a row's last-run badge keeps a healthy/succeeded row calm (muted) and
 * only colors the states worth noticing (failed/running/queued).
 */
export function runStatusColor(
  status: AutomationRunStatus | string,
  { quietSuccess = false }: { quietSuccess?: boolean } = {},
): string {
  switch (status) {
    case "failed":
      return "var(--color-danger)";
    case "running":
      return "var(--accent-presence)";
    case "queued":
      return "var(--color-warning)";
    case "succeeded":
      return quietSuccess ? "var(--text-muted)" : "var(--accent-presence)";
    default:
      return "var(--text-muted)";
  }
}
