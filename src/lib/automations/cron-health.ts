import type { AutomationRunRecord } from "@/lib/automation-runs";
import type { CodexAutomation } from "@/lib/codex-automations-types";

/**
 * Operational health of one cron, as the Rituals crons list draws it.
 *
 * The `Rituals Redesign.dc.html` handoff specifies five states — running,
 * healthy, failed, stale, paused — each with its own glyph SHAPE so the row
 * never encodes status by color alone. Four of them are backed by data this app
 * actually holds; `stale` is not, and is deliberately absent:
 *
 * `automation-runs.json` records **app-triggered "run now" executions only** —
 * the daemon's scheduled runs never reach it (see `src/lib/automation-runs.ts`).
 * So "no successful run in N days" cannot be distinguished from "runs nightly on
 * the daemon and has simply never been run by hand", and a row claiming *stale*
 * would be a row that lies about a perfectly healthy cron. The frame's stale
 * state is therefore cut rather than faked.
 *
 * For the same reason `failed` is scoped honestly: it means the newest run this
 * app recorded ended in failure, and every surface that renders it says so.
 */
export type CronHealth = "running" | "failed" | "healthy" | "paused";

/** Derive a row's health from its automation record plus its newest known run. */
export function cronHealth(
  auto: Pick<CodexAutomation, "status">,
  lastRun: Pick<AutomationRunRecord, "status"> | undefined,
): CronHealth {
  if (auto.status === "PAUSED") return "paused";
  if (lastRun?.status === "running" || lastRun?.status === "queued") return "running";
  if (lastRun?.status === "failed") return "failed";
  return "healthy";
}

/** Short status word for the row's `role="img"` label and the detail header. */
export function cronHealthLabel(health: CronHealth): string {
  switch (health) {
    case "running":
      return "Running now";
    case "failed":
      return "Last run failed";
    case "paused":
      return "Paused";
    default:
      return "Healthy";
  }
}

/**
 * The header's failing chip and its filter both count the same thing: active
 * crons whose newest recorded run failed. Paused crons are excluded — a paused
 * cron is not failing, it is off.
 */
export function failingCronIds(
  autos: readonly CodexAutomation[],
  lastRunById: ReadonlyMap<string, Pick<AutomationRunRecord, "status">>,
): Set<string> {
  const ids = new Set<string>();
  for (const auto of autos) {
    if (cronHealth(auto, lastRunById.get(auto.id)) === "failed") ids.add(auto.id);
  }
  return ids;
}
