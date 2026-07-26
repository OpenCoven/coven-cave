/**
 * stale-running-sweep.ts — present leaked "running" daemon rows as orphaned.
 *
 * `coven run`-registered sessions (board enrich-steps, workflows, chat
 * one-shots) leave the daemon a row it does not own a process for: the CLI
 * spawns the harness itself and reports terminal status back. When that CLI
 * process dies without reporting — request abort SIGTERMs it, or the app/
 * server quits mid-run — the row is stuck in "running" forever. The daemon
 * only reconciles at ITS OWN restart (marking them "orphaned"); `kill`
 * refuses (`session_not_live`), `sacrifice` refuses ("still running"), and
 * there is no HTTP delete route. Meanwhile every running-tone surface (the
 * menu bar's Running-processes popover, sidebar badges) presents the ghost as
 * a live process whose chat opens to "Chat history unavailable".
 *
 * This sweep converges the *presentation* with what the daemon itself would
 * say after a restart: a running-tone row that is old enough and shows no
 * process I/O in the daemon's event log is presented as "orphaned". The
 * events probe is the discriminator that protects genuinely-live
 * daemon-spawned PTY sessions — those are daemon children wired straight
 * into the events table (they emit `output` events from their first prompt
 * paint), while `coven run` sessions never produce process I/O (at most a
 * stray metadata annotation like `patch_metadata`). The probe is read-only
 * (`GET /api/v1/sessions/{id}/events`), so a mid-flight slow run is never
 * harmed: if it later reports completion the daemon row transitions
 * normally and the override stops applying.
 */

import { callDaemon } from "@/lib/coven-daemon";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";
import { parseDaemonTime } from "@/lib/server/stuck-created-sweep";
import { sessionStatusTone } from "@/lib/session-status";

/** Minimal structural cut of the daemon session row the sweep reads. */
export type StaleRunningRow = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * A row this old that still claims a running tone, with nothing having
 * touched `updated_at` since creation and no in-process chat run, is past
 * any legitimate `coven run` lifetime (enrich runs are request-scoped
 * minutes; chat turns are covered by the active-run registry).
 */
export const STALE_RUNNING_THRESHOLD_MS = 30 * 60 * 1000;

/** Presented status for a confirmed ghost — the daemon's own restart verdict. */
export const STALE_RUNNING_PRESENTED_STATUS = "orphaned";

/**
 * Pure classifier: which rows are *candidates* for the ghost probe?
 * Running tone + both timestamps beyond the threshold + no live chat run in
 * this server process. Unparsable timestamps never qualify (NaN fails the
 * comparison), so a malformed row is skipped, not swept.
 */
export function staleRunningCandidates(
  rows: StaleRunningRow[],
  opts: {
    nowMs: number;
    thresholdMs?: number;
    hasActiveChatRun: (sessionId: string) => boolean;
  },
): string[] {
  const threshold = opts.thresholdMs ?? STALE_RUNNING_THRESHOLD_MS;
  return rows
    .filter((row) => {
      if (sessionStatusTone(row.status) !== "running") return false;
      const createdMs = parseDaemonTime(row.created_at);
      const updatedMs = parseDaemonTime(row.updated_at);
      if (!(opts.nowMs - createdMs >= threshold)) return false;
      if (!(opts.nowMs - updatedMs >= threshold)) return false;
      return !opts.hasActiveChatRun(row.id);
    })
    .map((row) => row.id);
}

/**
 * Probe verdict for one session: `true` = confirmed ghost (probe succeeded,
 * no process I/O events), `false` = provably alive (has PTY output/input),
 * `null` = unknown (probe failed — daemon busy/offline/no events capability,
 * or too many metadata events to rule on). Unknown must fail open: the row
 * keeps its daemon status.
 */
export type GhostVerdict = boolean | null;

type EventsProbe = (sessionId: string) => Promise<GhostVerdict>;

/** Event kinds that prove a real harness process was wired to the daemon.
 *  Daemon-spawned PTY children emit `output` immediately (prompt paint);
 *  leaked `coven run` registrations never do — their event log is empty or
 *  carries only metadata annotations (`patch_metadata`, `cast`). */
const PROCESS_IO_EVENT_KINDS = new Set(["output", "input"]);

const EVENTS_PROBE_LIMIT = 16;

/**
 * Pure verdict from an events-endpoint response. Ghost only when the probe
 * saw the session's *complete* event log (no `hasMore`) and none of it is
 * process I/O. A page full of metadata with more behind it is unrulable —
 * fail open rather than risk hiding a live process.
 */
export function ghostVerdictFromEventsResponse(data: unknown): GhostVerdict {
  if (!data || typeof data !== "object") return null;
  const events = (data as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    const kind = (event as { kind?: unknown } | null)?.kind;
    if (typeof kind === "string" && PROCESS_IO_EVENT_KINDS.has(kind)) return false;
  }
  const hasMore = (data as { hasMore?: unknown }).hasMore;
  if (hasMore === true || events.length >= EVENTS_PROBE_LIMIT) return null;
  return true;
}

async function probeSessionForGhost(sessionId: string): Promise<GhostVerdict> {
  const res = await callDaemon<unknown>({
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/events?limit=${EVENTS_PROBE_LIMIT}`,
  });
  if (!res.ok) return null;
  return ghostVerdictFromEventsResponse(res.data);
}

// Verdict cache so the polled session list doesn't re-probe every request.
// Keyed by id|updated_at: any daemon-side transition (a slow run finally
// reporting completion) changes the key and invalidates the entry. Only
// definite verdicts are cached — probe failures retry on the next sweep.
const verdictCache = new Map<string, boolean>();
const VERDICT_CACHE_MAX = 512;

function cacheVerdict(key: string, verdict: boolean): void {
  if (verdictCache.size >= VERDICT_CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest !== undefined) verdictCache.delete(oldest);
  }
  verdictCache.set(key, verdict);
}

/** Test seam: reset module-level cache state. */
export function resetStaleRunningSweepCache(): void {
  verdictCache.clear();
}

// Bound the per-sweep probe fan-out. Ghosts accumulate slowly (a handful per
// leak incident); anything beyond the cap waits for the next list request.
const MAX_PROBES_PER_SWEEP = 16;

/**
 * Classify candidates and return the set of confirmed-ghost session ids.
 * Best-effort and read-only: never throws, probe failures leave rows
 * untouched. Injectable probe keeps the daemon out of unit tests.
 */
export async function sweepStaleRunningGhosts(
  rows: StaleRunningRow[],
  opts?: {
    nowMs?: number;
    thresholdMs?: number;
    hasActiveChatRun?: (sessionId: string) => boolean;
    probe?: EventsProbe;
  },
): Promise<Set<string>> {
  const ghosts = new Set<string>();
  try {
    const candidates = staleRunningCandidates(rows, {
      nowMs: opts?.nowMs ?? Date.now(),
      thresholdMs: opts?.thresholdMs,
      hasActiveChatRun: opts?.hasActiveChatRun ?? hasActiveChatRun,
    });
    if (candidates.length === 0) return ghosts;

    const rowById = new Map(rows.map((row) => [row.id, row]));
    const probe = opts?.probe ?? probeSessionForGhost;
    const toProbe: Array<{ id: string; key: string }> = [];
    for (const id of candidates) {
      const key = `${id}|${rowById.get(id)?.updated_at ?? ""}`;
      const cached = verdictCache.get(key);
      if (cached === true) ghosts.add(id);
      else if (cached === undefined && toProbe.length < MAX_PROBES_PER_SWEEP) {
        toProbe.push({ id, key });
      }
    }

    const verdicts = await Promise.all(
      toProbe.map(async ({ id, key }) => {
        try {
          return { id, key, verdict: await probe(id) };
        } catch {
          return { id, key, verdict: null as GhostVerdict };
        }
      }),
    );
    for (const { id, key, verdict } of verdicts) {
      if (verdict === null) continue;
      cacheVerdict(key, verdict);
      if (verdict) ghosts.add(id);
    }
    return ghosts;
  } catch {
    return ghosts;
  }
}

/**
 * Rewrite daemon rows so confirmed ghosts carry the presented "orphaned"
 * status before the merge — downstream (status tones, the Running popover,
 * archive sweeps) then treats them exactly like restart-orphaned rows.
 */
export function applyStaleRunningPresentation<T extends { id: string; status: string }>(
  rows: T[],
  ghosts: Set<string>,
): T[] {
  if (ghosts.size === 0) return rows;
  return rows.map((row) =>
    ghosts.has(row.id) ? { ...row, status: STALE_RUNNING_PRESENTED_STATUS } : row,
  );
}
