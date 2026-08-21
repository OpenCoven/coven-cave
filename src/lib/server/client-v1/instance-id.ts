import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { caveHome } from "@/lib/coven-paths";

import { CLIENT_V1_LIMITS } from "./contract.ts";

/**
 * A stable identifier for this Cave installation, served on the Client v1
 * health contract.
 *
 * Clients cache pairing credentials against a specific Cave. Without an
 * instance identity they cannot tell "the Cave I paired with restarted" from
 * "I am now pointed at a different Cave that happens to answer on the same
 * loopback port" — the second case must invalidate every cached credential and
 * cursor, and the first must not.
 *
 * It identifies an installation, never a person or a machine: a random UUID
 * generated on first read and persisted, with no hostname, username, or
 * hardware value mixed in. It is deliberately public on an unauthenticated
 * health endpoint, so it must stay unlinkable to anything but itself.
 */
const INSTANCE_ID_ENV = "COVEN_CAVE_CLIENT_V1_INSTANCE_ID";

/**
 * The id this process resolved, and the file it came from.
 *
 * The id never changes once minted, but every request to the unauthenticated,
 * `force-dynamic` health route was re-reading it: 340 us per call measured
 * against a Cave home under the Windows user profile, 92% of the whole
 * handler's cost, all of it synchronous and therefore blocking every other
 * route in the process for the duration. An unauthenticated caller could
 * schedule that read as fast as it could send GETs.
 *
 * Keyed on the file rather than held in a bare slot because COVEN_CAVE_HOME is
 * process configuration a test repoints between cases, and a bare slot would
 * serve one installation's id for another's home. The consequence in
 * production is deliberate: deleting the store under a running Cave does not
 * mint a new identity until restart, which is what a client caching a pairing
 * against this id needs.
 */
type ResolvedInstance = {
  file: string;
  instanceId: string;
  /** False while this id exists only in this process's memory. */
  persisted: boolean;
  /**
   * Monotonic ms (`performance.now`) before which no further store attempt is
   * made. Not epoch ms: this measures an elapsed interval, and the wall clock
   * is not one — see UNPERSISTED_RETRY_INTERVAL_MS.
   */
  retryAfter: number;
};

let resolved: ResolvedInstance | null = null;

function remember(file: string, instanceId: string, persisted: boolean): string {
  resolved = { file, instanceId, persisted, retryAfter: 0 };
  return instanceId;
}

/**
 * How long a process that could not write the store waits before trying again.
 *
 * Remembering the id is what stopped it churning per request, but it also
 * stopped the write ever being retried: a Cave that met a full disk, an
 * unmounted home, or a scanner holding the file on its first health request
 * served a memory-only id for the rest of its life and minted a *different* one
 * at next boot, so every paired client re-paired — the exact failure instanceId
 * exists to prevent, now triggered by a condition that had already cleared.
 * Before the id was remembered this healed on the next request.
 *
 * The retry is throttled rather than per-request so an anonymous caller cannot
 * schedule the write attempts, and it never adopts an id another process
 * published in the meantime: this one has already been served, and swapping it
 * mid-life is the churn being avoided. The two converge at the next restart,
 * when both read the same file.
 *
 * Measured on the monotonic clock, not the wall clock. `Date.now()` moves
 * backwards on an NTP step, a VM snapshot restore, or a hand-corrected clock,
 * and a deadline computed from it is then unreachable for the whole size of the
 * jump — hours or days, during which nothing retries and the very failure this
 * retry exists to end goes back to being permanent for that boot.
 */
const UNPERSISTED_RETRY_INTERVAL_MS = 60_000;

function healUnpersisted(entry: ResolvedInstance): void {
  const now = performance.now();
  if (now < entry.retryAfter) return;
  entry.retryAfter = now + UNPERSISTED_RETRY_INTERVAL_MS;
  entry.persisted = persistInstanceId(entry.file, entry.instanceId);
}

/**
 * The oversized override this process has already complained about.
 *
 * An ignored override is otherwise indistinguishable from a working one from
 * outside: the operator pins an id, health answers 200 with a *different* id,
 * and every client pairs against an identity their fleet tooling does not know.
 * Refusing to answer instead would take the diagnostic surface down over a
 * misconfiguration it can route around, so say it once and serve a usable id.
 * Keyed on the value so a corrected-but-still-oversized setting is reported
 * again, while an unchanged one cannot be replayed per request.
 */
let warnedOverride: string | null = null;

function warnOversizedOverride(override: string): void {
  if (warnedOverride === override) return;
  warnedOverride = override;
  console.warn(
    `[client-v1] ${INSTANCE_ID_ENV} is ${override.length} characters; the Client v1 contract allows ` +
      `${CLIENT_V1_LIMITS.instanceIdCharacters}. Ignoring it and serving the persisted instance id instead.`,
  );
}

export function clientV1InstanceIdFile(): string {
  return path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-instance.json");
}

function readPersistedInstanceId(file: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const instanceId = (parsed as { instanceId?: unknown }).instanceId;
    return typeof instanceId === "string" && instanceId.trim() ? instanceId : null;
  } catch {
    return null;
  }
}

/**
 * Store a freshly minted id without overwriting one another process published.
 *
 * The exclusive flag is what turns the caller's re-read into an adoption
 * rather than a coin toss. Two Caves booting together both find no store and
 * both mint; a plain write let the second clobber an id the first had already
 * served, and now that each process remembers what it read, that divergence no
 * longer heals on the next request — the two answer with different instance
 * ids until restart, and every client paired against the overwritten one
 * re-pairs.
 *
 * EEXIST over a store holding nothing usable is the other case: a truncated or
 * hand-edited record has no winner to lose to, so it is repaired in place.
 *
 * Reports whether the store now holds a usable record — losing the race counts,
 * because the identity is durable either way. The caller needs that to know
 * whether the id it serves survives a restart.
 */
function persistInstanceId(file: string, instanceId: string): boolean {
  const record = `${JSON.stringify({ instanceId }, null, 2)}\n`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, record, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "EEXIST") return false;
  }
  if (readPersistedInstanceId(file)) return true;
  try {
    writeFileSync(file, record, { encoding: "utf8" });
    return true;
  } catch {
    // Read-only or full disk; the caller degrades to the minted id.
    return false;
  }
}

/**
 * Read the persisted instance id, minting and storing one on first call.
 *
 * A write failure returns the freshly minted id rather than throwing: health
 * is a diagnostic surface and must answer on a read-only or full disk. The id
 * is then per-process rather than per-installation, which is the correct
 * degraded behaviour — a client sees an instance change and re-pairs, instead
 * of the endpoint failing outright. Remembering it is what makes that true:
 * unremembered, the degraded path minted a fresh uuid on every request, so a
 * client re-paired on every call rather than once. It stays that id, and starts
 * being per-installation again the moment the store becomes writable.
 */
export function clientV1InstanceId(): string {
  const override = process.env[INSTANCE_ID_ENV]?.trim();
  // Bounded by the contract's own declared limit, not by trust in the operator:
  // a longer override is served on a 200 that parseClientV1Health then refuses,
  // so the client cannot read the compatibility answer at all and has nothing to
  // fall back on. Ignoring it keeps health answering with a contract-valid id.
  if (override && override.length > CLIENT_V1_LIMITS.instanceIdCharacters) warnOversizedOverride(override);
  else if (override) return override;

  const file = clientV1InstanceIdFile();
  if (resolved?.file === file) {
    if (!resolved.persisted) healUnpersisted(resolved);
    return resolved.instanceId;
  }

  const persisted = readPersistedInstanceId(file);
  if (persisted) return remember(file, persisted, true);

  const instanceId = randomUUID();
  const stored = persistInstanceId(file, instanceId);
  // Re-read rather than trusting the write: two processes starting together
  // both mint an id, and the loser of that race must adopt the winner's file
  // instead of serving an id that is about to disappear on next boot.
  const adopted = readPersistedInstanceId(file);
  return remember(file, adopted ?? instanceId, stored || adopted !== null);
}
