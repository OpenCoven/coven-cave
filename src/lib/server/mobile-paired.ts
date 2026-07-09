import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

// Paired-phone signal (golden path 5, cave-i74f). Pairing success used to be
// silent on the desktop: the phone scans, connects, and refreshes its token,
// but nothing on this side ever said so. The token-refresh route is the one
// beat every healthy paired device already hits (30-day rolling renewal +
// the refresh-on-launch), so recording its timestamp gives the Settings card
// an honest "Paired · last seen <t>" with zero new client traffic.

type MobilePairedState = { lastSeenAt: number };

export function mobilePairedPath(): string {
  return path.join(covenHome(), "cave-mobile-paired.json");
}

/** Record that a paired device just authenticated (token refresh succeeded).
 *  Best-effort: a write failure must never fail the refresh itself. */
export async function recordMobileSeen(now = Date.now()): Promise<void> {
  try {
    await writeJsonAtomic(mobilePairedPath(), { lastSeenAt: now } satisfies MobilePairedState);
  } catch {
    /* best-effort */
  }
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
