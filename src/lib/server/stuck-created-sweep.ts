/**
 * stuck-created-sweep.ts — reap daemon session rows orphaned in "created".
 *
 * `coven run` registers the session row with the daemon BEFORE launching the
 * harness, and the row's id only reaches the send route via the stream
 * handshake. A spawn that dies pre-handshake (fork exhaustion, missing
 * adapter, crash) therefore strands a row in status "created" forever: the
 * daemon has no reaper, and the route never learned an id it could fail.
 * Group-chat fan-out multiplies the leak — one prompt to N familiars is N
 * parallel spawns, so a wedged machine leaks N identical rows in the same
 * second (bd cave-zef7: the 2×"ping" ledger rows).
 *
 * The sweep runs only on the send route's no-handshake failure path. It lists
 * the daemon's sessions and matches rows that are provably this turn's
 * orphans — status "created", the same project root the spawn used, created
 * inside the turn's window, and a title that is the head of this turn's
 * prompt (the daemon derives titles from the prompt). Matches are deleted for
 * real via `coven sacrifice` (the daemon has no HTTP delete route) and always
 * tombstoned locally so the UI hides the ghost row even when the CLI call
 * fails (e.g. the daemon is still wedged).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sacrificeSessionLocal } from "@/lib/cave-config";
import { covenLaunchCommand, covenSpawnEnv } from "@/lib/coven-bin";
import { callDaemon } from "@/lib/coven-daemon";

const execFileAsync = promisify(execFile);

/** Same shape the sessions/list route reads from GET /api/v1/sessions. */
export type DaemonSessionRow = {
  id: string;
  project_root: string;
  title: string;
  status: string;
  created_at: string;
};

/** Mirrors the sessions/[id] route's id validation — no argv surprises. */
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,256}$/;

const SACRIFICE_TIMEOUT_MS = 8000;

/**
 * Parse a daemon RFC3339 timestamp. The daemon emits nanosecond fractions
 * ("…48.329877000Z"), which are outside what Date.parse guarantees — truncate
 * the fraction to milliseconds first. Returns NaN when unparsable, and NaN
 * never matches the window comparison, so a bad row is skipped, not swept.
 */
export function parseDaemonTime(iso: string): number {
  return Date.parse(iso.replace(/\.(\d{3})\d*(?=Z|[+-])/, ".$1"));
}

/**
 * Pure matcher: which rows are this turn's orphaned "created" registrations?
 * A row qualifies only when every axis agrees it came from this spawn:
 * status, project root, creation time inside the window, and a non-empty
 * title that is a prefix of the prompt this turn actually sent.
 */
export function matchStuckCreatedRows(
  rows: DaemonSessionRow[],
  opts: { cwd: string; prompt: string; sinceMs: number },
): string[] {
  const prompt = opts.prompt.trim();
  if (!prompt) return [];
  return rows
    .filter((row) => {
      if (row.status !== "created") return false;
      if (row.project_root !== opts.cwd) return false;
      const createdMs = parseDaemonTime(row.created_at);
      if (!(createdMs >= opts.sinceMs)) return false;
      const title = (row.title ?? "").trim();
      return title.length > 0 && prompt.startsWith(title);
    })
    .map((row) => row.id);
}

/**
 * List → match → sacrifice → tombstone. Never throws: this runs on a failure
 * path that must stay best-effort. Returns the ids it swept.
 */
export async function sweepStuckCreatedSessions(opts: {
  cwd: string;
  prompt: string;
  sinceMs: number;
}): Promise<string[]> {
  try {
    const res = await callDaemon<DaemonSessionRow[]>({ path: "/api/v1/sessions" });
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    const ids = matchStuckCreatedRows(rows, opts).filter((id) => SESSION_ID_RE.test(id));
    for (const id of ids) {
      try {
        const { command, fixedArgs } = covenLaunchCommand();
        await execFileAsync(command, [...fixedArgs, "sacrifice", id, "--yes"], {
          env: covenSpawnEnv(),
          timeout: SACRIFICE_TIMEOUT_MS,
        });
      } catch {
        // The daemon row survives (daemon down or CLI missing); the local
        // tombstone below still hides it from every session list.
      }
      try {
        await sacrificeSessionLocal(id);
      } catch {
        // State write failed; the daemon-side sacrifice above still counts.
      }
    }
    return ids;
  } catch {
    return [];
  }
}
