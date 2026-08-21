/**
 * /api/client/v1/health
 *
 * The compatibility handshake every Client v1 consumer performs before it
 * pairs: it states the API version this Cave speaks, the oldest client it will
 * accept, the capabilities available, whether pairing is required, which
 * installation is answering, and which release is running.
 *
 * Unauthenticated by design — a client must be able to discover it is too old
 * *before* it holds a credential, otherwise an incompatible client can only
 * learn so by failing a paired request. It therefore returns no user data, no
 * paths, and no configuration values; the instance id identifies an
 * installation, not a person (see client-v1/instance-id.ts).
 */

import { APP_VERSION } from "@/lib/app-version";
import {
  CLIENT_V1_PAIRING_REQUIRED,
  type ClientV1Health,
} from "@/lib/server/client-v1/contract";
import { clientV1InstanceId } from "@/lib/server/client-v1/instance-id";
import { clientV1SuccessResponse } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health: ClientV1Health = {
    instanceId: clientV1InstanceId(),
    pairingRequired: CLIENT_V1_PAIRING_REQUIRED,
    releaseVersion: APP_VERSION,
  };
  // apiVersion, minimumClientVersion, and capabilities ride the shared
  // envelope rather than being repeated in `data` — one source, so a client
  // can never read two different answers out of the same response.
  return clientV1SuccessResponse(health);
}
