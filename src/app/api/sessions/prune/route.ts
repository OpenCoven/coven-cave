import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sacrificeSessionLocal } from "@/lib/cave-config";
import { covenLaunchCommand, covenSpawnEnv } from "@/lib/coven-bin";
import { callDaemon } from "@/lib/coven-daemon";
import { invalidateSessionsListCache } from "@/lib/server/sessions-list-cache";
import { isValidSessionId } from "@/lib/server/session-id";
import { prunePayload } from "./prune-response";

const execFileAsync = promisify(execFile);

const SACRIFICE_TIMEOUT_MS = 8000;

export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/prune
 *
 * Asks the daemon to drop completed / failed / killed sessions whose
 * `updated_at` is older than `olderThanHours` (default: 24).
 *
 * The daemon endpoint `/api/v1/sessions/prune` is expected to return:
 *   { pruned: number }
 *
 * If the daemon doesn't support the endpoint yet, we perform client-side
 * pruning: we list all sessions, filter locally, and remove each one via
 * `coven sacrifice` — the daemon has no HTTP delete route (DELETE
 * /api/v1/sessions/{id} 404s), so the CLI is the only real deletion path
 * (same as stuck-created-sweep). Each swept row is also tombstoned locally
 * so the merged session list hides it even when the CLI call fails.
 *
 * Query/body params:
 *   olderThanHours  number  default 24
 *   dryRun          boolean default false  — count only, no deletes
 */
export async function POST(req: Request) {
  let body: { olderThanHours?: number; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* body is optional */
  }

  const olderThanHours = typeof body.olderThanHours === "number" ? body.olderThanHours : 24;
  const dryRun = body.dryRun === true;

  // Try native daemon prune endpoint first.
  const native = await callDaemon<{ pruned: number }>({
    method: "POST",
    path: "/api/v1/sessions/prune",
    body: { olderThanHours, dryRun },
    timeoutMs: 10_000,
  });

  if (native.ok && native.data) {
    // On a dry run the daemon reports how many sessions *would* be pruned; the
    // shared payload helper routes that to `wouldPrune` so the Maintenance
    // "Check" UI reads it the same way it does for the client path below.
    if (!dryRun && native.data.pruned > 0) invalidateSessionsListCache();
    return NextResponse.json(
      prunePayload({ dryRun, count: native.data.pruned, method: "daemon" }),
    );
  }

  // Daemon doesn't support prune natively — do client-side pruning.
  type DaemonSession = {
    id: string;
    status: string;
    updated_at: string;
  };

  const listRes = await callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" });
  if (!listRes.ok || !listRes.data) {
    return NextResponse.json(
      {
        ok: false,
        error: `session list failed: ${listRes.error ?? `http ${listRes.status}`}`,
      },
      { status: 502 },
    );
  }

  const STALE_STATUSES = new Set(["completed", "failed", "killed", "stopped", "orphaned"]);
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;

  const candidates = listRes.data.filter((s) => {
    if (!STALE_STATUSES.has(s.status)) return false;
    const updated = new Date(s.updated_at).getTime();
    return updated < cutoff;
  });

  if (dryRun) {
    return NextResponse.json(
      prunePayload({ dryRun: true, count: candidates.length, method: "client" }),
    );
  }

  let pruned = 0;
  for (const s of candidates) {
    // Mirrors the sessions/[id] route's id validation — no argv surprises.
    if (!isValidSessionId(s.id)) continue;
    try {
      const { command, fixedArgs } = covenLaunchCommand();
      await execFileAsync(command, [...fixedArgs, "sacrifice", s.id, "--yes"], {
        env: covenSpawnEnv(),
        timeout: SACRIFICE_TIMEOUT_MS,
      });
      pruned++;
    } catch {
      // The daemon row survives (daemon down or CLI missing); the local
      // tombstone below still hides it from every session list.
    }
    try {
      await sacrificeSessionLocal(s.id);
    } catch {
      // State write failed; the daemon-side sacrifice above still counts.
    }
  }

  // Local tombstones are written even when the CLI call fails, so the merged
  // list changes whenever anything was attempted — not just on CLI successes.
  if (candidates.length > 0) invalidateSessionsListCache();
  return NextResponse.json(prunePayload({ dryRun: false, count: pruned, method: "client" }));
}
