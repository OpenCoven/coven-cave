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
 * of the endpoint failing outright.
 */
export function clientV1InstanceId(): string {
  const override = process.env[INSTANCE_ID_ENV]?.trim();
  if (override) return override;

  const file = clientV1InstanceIdFile();
  const persisted = readPersistedInstanceId(file);
  if (persisted) return persisted;

  const instanceId = randomUUID();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ instanceId }, null, 2)}\n`, { encoding: "utf8" });
  } catch {
    return instanceId;
  }
  // Re-read rather than trusting the write: two processes starting together
  // both mint an id, and the loser of that race must adopt the winner's file
  // instead of serving an id that is about to disappear on next boot.
  return readPersistedInstanceId(file) ?? instanceId;
}
