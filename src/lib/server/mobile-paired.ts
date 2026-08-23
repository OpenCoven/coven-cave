import { readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import { MOBILE_ACCESS_HEADER } from "@/proxy-helpers";

// Paired-phone signal (golden path 5, cave-i74f). A successful authenticated
// mobile roster probe is the earliest reliable proof that the phone completed
// pairing. Token renewal is intentionally much less frequent (30-day tokens
// refresh only near expiry), so it remains an unconditional secondary beat
// rather than the event that first creates this file.

type MobilePairedState = { lastSeenAt: number };

export const MOBILE_PRESENCE_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// All writers in this server process share one queue. Besides coalescing the
// iOS app's overlapping bootstrap/foreground probes, serialization prevents a
// delayed rate-limited beat from overwriting a newer unconditional token-
// refresh beat. The on-disk timestamp remains the cross-process authority;
// writeJsonAtomic keeps the file complete if another Cave process also writes.
let mobileSeenWriteQueue: Promise<void> = Promise.resolve();

function serializeMobileSeenWrite(operation: () => Promise<void>): Promise<void> {
  const queued = mobileSeenWriteQueue.then(operation, operation);
  mobileSeenWriteQueue = queued.catch(() => {});
  return queued;
}

async function writeMobileSeen(now: number): Promise<void> {
  await writeJsonAtomic(mobilePairedPath(), { lastSeenAt: now } satisfies MobilePairedState);
}

export function mobilePairedPath(): string {
  return path.join(caveHome(), "mobile-paired.json");
}

/** Record that a paired device just authenticated (token refresh succeeded).
 *  This path is deliberately unconditional: token renewal is rare and must
 *  always advance the paired signal even when a roster beat just landed.
 *  Best-effort: a write failure must never fail the refresh itself. */
export async function recordMobileSeen(now = Date.now()): Promise<void> {
  await serializeMobileSeenWrite(async () => {
    try {
      await writeMobileSeen(now);
    } catch {
      /* best-effort */
    }
  });
}

/**
 * Record an authenticated mobile liveness probe without rewriting the state
 * file on every foreground timer tick. The serialized read/check/write makes
 * concurrent probes deterministic: the first due probe advances the file and
 * the rest observe that timestamp and coalesce into it.
 */
export async function recordMobilePresenceBeat(now = Date.now()): Promise<void> {
  await serializeMobileSeenWrite(async () => {
    try {
      const lastSeenAt = await readMobileLastSeen();
      if (
        lastSeenAt !== null &&
        now < lastSeenAt + MOBILE_PRESENCE_WRITE_INTERVAL_MS
      ) {
        return;
      }
      await writeMobileSeen(now);
    } catch {
      /* best-effort */
    }
  });
}

/**
 * Route boundary for presence beats. The proxy strips any caller-supplied
 * marker and restores it only after validating the paired-phone credential,
 * so desktop/local and unauthenticated requests never create pairing state.
 */
export async function recordMobilePresenceForRequest(
  req: Pick<Request, "headers">,
  now = Date.now(),
): Promise<void> {
  if (req.headers.get(MOBILE_ACCESS_HEADER) !== "1") return;
  await recordMobilePresenceBeat(now);
}

/** The last time a paired device authenticated, or null when never/unreadable. */
export async function readMobileLastSeen(): Promise<number | null> {
  try {
    const raw = await readFile(mobilePairedPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<MobilePairedState>;
    return typeof parsed.lastSeenAt === "number" && Number.isFinite(parsed.lastSeenAt)
      ? parsed.lastSeenAt
      : null;
  } catch {
    return null;
  }
}
