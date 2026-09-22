import { readFile } from "node:fs/promises";

import {
  clientV1DiscoveryPath,
  validateClientV1DiscoveryRecord,
} from "./discovery.ts";
import { resolveUnverifiedOwnershipWaiver } from "./path-ownership.ts";

/**
 * Operational state of the client v1 surface itself, for the Settings screen
 * that manages it (cave-6rwq0).
 *
 * Two degraded states existed only on stderr until this module surfaced them:
 *
 *  - The CLIENT V1 DISABLED banner (server.ts reportClientV1DiscoveryUnavailable)
 *    prints when the discovery record cannot be published. This module reports
 *    the same observable a paired client would see: is there a valid discovery
 *    record for a live process at the discovery path? If publishing failed, no
 *    record was written (or only a stale one from a dead process remains), so
 *    the probe answers "unavailable" with the reason a reader would hit.
 *
 *  - The SECURITY WAIVER line (path-ownership.ts unverifiedOwnershipDisclosure)
 *    prints once per waived path when the operator has granted the
 *    unverified-ownership waiver. The waiver is a pure function of the launch
 *    environment, so the same resolver the ownership guard consults is read
 *    here; a granted waiver is reported persistently instead of once per path.
 */

export type ClientV1DiscoveryStatus =
  | { available: true }
  | { available: false; reason: string };

export type ClientV1OwnershipWaiverStatus =
  | { granted: false }
  | { granted: true; reason: string };

export type ClientV1Status = {
  discovery: ClientV1DiscoveryStatus;
  ownershipWaiver: ClientV1OwnershipWaiverStatus;
};

/**
 * What server.ts records about its own publication attempt, so this module
 * can tell four states apart that all look like "no usable record" from the
 * filesystem alone (#5517): refused at startup, published then removed by
 * another instance sharing the home, owned by another live instance, and no
 * attempt recorded at all. `republish` re-runs publication for the
 * published-then-removed case only; it never replaces a live foreign record.
 */
export type ClientV1DiscoveryPublication = {
  path: string;
  endpoint: string;
  nonce: string;
  published: boolean;
  failure?: { category: string; message: string };
  republish?: () => boolean;
};

declare global {
  var __covenCaveClientV1Discovery: ClientV1DiscoveryPublication | undefined;
}

/** The reason when this process recorded no publication attempt at all. */
export const CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL =
  "No client v1 discovery record exists for this Cave home, and this process "
  + "recorded no publication attempt.";

export function clientV1DiscoveryPublication(): ClientV1DiscoveryPublication | undefined {
  return globalThis.__covenCaveClientV1Discovery;
}

function foreignOwnerReason(
  record: { pid: number; endpoint: string },
  publication: ClientV1DiscoveryPublication,
): string {
  return `Another Cave process (pid ${record.pid}) owns the client v1 discovery `
    + `record for this Cave home and points paired clients at ${record.endpoint}; `
    + `this server (${publication.endpoint}) is not discoverable. Stop that `
    + "instance and restart this one, or give each instance its own COVEN_CAVE_HOME.";
}

function removedReason(publication: ClientV1DiscoveryPublication): string {
  return "This server published its client v1 discovery record at startup, but "
    + "the record has since been removed — another Cave instance sharing "
    + `${publication.path} exited and cleaned it up. Restart this server to `
    + "publish it again.";
}

function refusedReason(publication: ClientV1DiscoveryPublication): string {
  const failure = publication.failure;
  const category = failure?.category ?? "disabled-other";
  const message = failure?.message ?? "no detail was recorded";
  return `Publication was refused when this server started (${category}): `
    + `${message}${/[.!?]$/u.test(message) ? "" : "."} Repair the cause and restart.`;
}

export function resolveClientV1OwnershipWaiverStatus(
  env: Record<string, string | undefined> = process.env,
): ClientV1OwnershipWaiverStatus {
  const waiver = resolveUnverifiedOwnershipWaiver(env);
  return waiver.granted
    ? { granted: true, reason: waiver.reason }
    : { granted: false };
}

export async function resolveClientV1DiscoveryStatus(
  root?: string,
  publication: ClientV1DiscoveryPublication | undefined = clientV1DiscoveryPublication(),
): Promise<ClientV1DiscoveryStatus> {
  const path = clientV1DiscoveryPath(root);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!publication) {
      return { available: false, reason: CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL };
    }
    if (!publication.published) {
      return { available: false, reason: refusedReason(publication) };
    }
    // Published, then removed: another instance sharing the home exited and
    // cleaned up. The slot is free, so the server republishes its own record
    // rather than staying dark until an operator notices and restarts.
    if (publication.republish?.() === true) {
      return { available: true };
    }
    const after = clientV1DiscoveryPublication();
    if (after && !after.published && after.failure) {
      return { available: false, reason: refusedReason(after) };
    }
    return { available: false, reason: removedReason(publication) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      available: false,
      reason: "The client v1 discovery record is not valid JSON.",
    };
  }

  let record: ReturnType<typeof validateClientV1DiscoveryRecord>;
  try {
    record = validateClientV1DiscoveryRecord(parsed);
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error
        ? error.message
        : "The client v1 discovery record is invalid.",
    };
  }

  if (publication && record.nonce !== publication.nonce) {
    return { available: false, reason: foreignOwnerReason(record, publication) };
  }
  return { available: true };
}

export async function resolveClientV1Status(root?: string): Promise<ClientV1Status> {
  const [discovery, ownershipWaiver] = await Promise.all([
    resolveClientV1DiscoveryStatus(root),
    Promise.resolve(resolveClientV1OwnershipWaiverStatus()),
  ]);
  return { discovery, ownershipWaiver };
}
