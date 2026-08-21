import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";

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
let resolved: { file: string; instanceId: string } | null = null;

function remember(file: string, instanceId: string): string {
  resolved = { file, instanceId };
  return instanceId;
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
 * Read the persisted instance id, minting and storing one on first call.
 *
 * A write failure returns the freshly minted id rather than throwing: health
 * is a diagnostic surface and must answer on a read-only or full disk. The id
 * is then per-process rather than per-installation, which is the correct
 * degraded behaviour — a client sees an instance change and re-pairs, instead
 * of the endpoint failing outright. Remembering it is what makes that true:
 * unremembered, the degraded path minted a fresh uuid on every request, so a
 * client re-paired on every call rather than once.
 */
export function clientV1InstanceId(): string {
  const override = process.env[INSTANCE_ID_ENV]?.trim();
  if (override) return override;

  const file = clientV1InstanceIdFile();
  if (resolved?.file === file) return resolved.instanceId;

  const persisted = readPersistedInstanceId(file);
  if (persisted) return remember(file, persisted);

  const instanceId = randomUUID();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ instanceId }, null, 2)}\n`, { encoding: "utf8" });
  } catch {
    return remember(file, instanceId);
  }
  // Re-read rather than trusting the write: two processes starting together
  // both mint an id, and the loser of that race must adopt the winner's file
  // instead of serving an id that is about to disappear on next boot.
  return remember(file, readPersistedInstanceId(file) ?? instanceId);
}
