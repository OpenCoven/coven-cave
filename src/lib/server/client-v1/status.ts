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

/** The banner's own explanation, restated for a reader of the Settings page. */
export const CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL =
  "The client v1 discovery record was NOT published, so paired clients cannot "
  + "find this server and every client v1 request stays refused. Everything "
  + "else on this server is running normally.";

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
): Promise<ClientV1DiscoveryStatus> {
  const path = clientV1DiscoveryPath(root);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { available: false, reason: CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL };
    }
    throw error;
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

  try {
    validateClientV1DiscoveryRecord(parsed);
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error
        ? error.message
        : "The client v1 discovery record is invalid.",
    };
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
