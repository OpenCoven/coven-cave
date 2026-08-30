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
    case "cancelled":
      // A deliberate stop, not a failure: calm tint, carried by the prohibit
      // glyph in `runStatusIcon` so the shape still says what happened.
      return "var(--text-muted)";
    default:
      return "var(--text-muted)";
  }
}

/**
 * Shared run-status → icon mapping (cave-dgli): the colored dot alone encoded
 * status by color only (WCAG 1.4.1) — a distinct SHAPE per status carries the
 * outcome for color-blind users, with `runStatusColor` still tinting it. All
 * names are already in the curated icon subset.
 */
export function runStatusIcon(status: AutomationRunStatus | string): "ph:x-circle-fill" | "ph:check-circle-fill" | "ph:clock-countdown" | "ph:play-fill" | "ph:prohibit" | "ph:circle-fill" {
  switch (status) {
    case "failed":
      return "ph:x-circle-fill";
    case "running":
      return "ph:play-fill";
    case "queued":
      return "ph:clock-countdown";
    case "succeeded":
      return "ph:check-circle-fill";
    case "cancelled":
      // Distinct shape (not a check, not a cross): the run was stopped on
      // purpose — neither an achievement nor a failure.
      return "ph:prohibit";
    default:
      return "ph:circle-fill";
  }
}
