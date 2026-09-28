import type { AutomationRunRecord } from "@/lib/automation-runs";
import { toAutomationRunRecord } from "@/lib/coven-automations-facade";
import { CovenAutomationsUnavailableError, type RoutineRun } from "@/lib/coven-automations-types";

/**
 * Newest run per automation, for the Schedules last-run badges (#5687).
 *
 * The view used to send one `/api/codex-automations/<id>/runs` request per
 * automation just to read `runs[0]`. Each call is ~100 ms at the daemon and
 * they run in parallel here, but in the browser they shared the six
 * per-host connections with the surface's other requests and queued behind
 * them (437–753 ms each on a first Inbox visit). One request now carries them.
 */

/** Bounds a hostile query string; the Schedules list is a handful of ids. */
export const MAX_LAST_RUN_IDS = 64;

const MAX_ID_LENGTH = 200;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/** The accepted ids, or the reason the query was rejected. Raw values are
 *  checked before trimming: `trim()` strips tabs and newlines, so trimming
 *  first would quietly turn `a\n` into a different, valid id. */
export function parseLastRunIds(
  params: URLSearchParams,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  const raw = params.getAll("id");
  // Ids are passed to the daemon as data, never joined into a path; these
  // checks only reject obvious garbage and bound the fan-out.
  if (raw.some((value) => CONTROL_CHAR_RE.test(value))) {
    return { ok: false, error: "automation ids must not contain control characters" };
  }
  const ids = [...new Set(raw.map((value) => value.trim()).filter(Boolean))];
  if (ids.some((id) => id.length > MAX_ID_LENGTH)) {
    return { ok: false, error: `automation ids must be at most ${MAX_ID_LENGTH} characters` };
  }
  if (ids.length > MAX_LAST_RUN_IDS) {
    return { ok: false, error: `expected at most ${MAX_LAST_RUN_IDS} automation ids` };
  }
  return { ok: true, ids };
}

export type LastRunsResult =
  | { ok: true; runs: Record<string, AutomationRunRecord | null> }
  | { ok: false; degraded: true; error: string };

export async function readLastRuns(
  ids: readonly string[],
  listRuns: (id: string, limit: number) => Promise<RoutineRun[]>,
): Promise<LastRunsResult> {
  const settled = await Promise.allSettled(ids.map((id) => listRuns(id, 1)));
  // Null prototype: an automation id is data, and one named `__proto__` must
  // land as a key rather than replace the object's prototype.
  const runs: Record<string, AutomationRunRecord | null> = Object.create(null);
  let outage: CovenAutomationsUnavailableError | null = null;
  let failures = 0;
  for (const [i, outcome] of settled.entries()) {
    const id = ids[i];
    if (outcome.status === "fulfilled") {
      const newest = outcome.value[0];
      runs[id] = newest ? toAutomationRunRecord(newest, id) : null;
      continue;
    }
    runs[id] = null;
    failures += 1;
    if (outcome.reason instanceof CovenAutomationsUnavailableError && outcome.reason.degraded) {
      outage = outcome.reason;
    }
  }
  // Every lookup failing on an offline daemon is an outage, reported the way
  // the other automation routes report it. A single missing or rejected
  // automation only loses its own badge.
  if (outage && failures === ids.length) {
    return { ok: false, degraded: true, error: outage.message };
  }
  return { ok: true, runs };
}
