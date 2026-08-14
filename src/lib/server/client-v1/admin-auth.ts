import { CLIENT_V1_ADMIN_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import { clientV1Error } from "./responses.ts";

const ADMIN_FORBIDDEN_MESSAGE = "Not authorized.";

export function requireClientV1Admin(req: Request): Response | null {
  const authorized = isTrustedLocalPeer(
    req.headers.get(CLIENT_V1_ADMIN_HEADER),
    process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
  );
  return authorized
    ? null
    : clientV1Error(403, "unauthorized", ADMIN_FORBIDDEN_MESSAGE, false);
}
