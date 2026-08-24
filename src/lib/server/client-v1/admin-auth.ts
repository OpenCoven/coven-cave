import {
  CLIENT_V1_ADMIN_HEADER,
  TOKEN_HEADER,
  expectedRequestOrigins,
  isAllowedRequestSourceAny,
  timingSafeEqualString,
} from "../../../proxy-helpers.ts";
import { clientV1ErrorResponse } from "./responses.ts";

function adminAuthorizationUnavailable(): Response {
  return clientV1ErrorResponse(
    "service_unavailable",
    "Cave admin authorization is not configured. Start Cave through the desktop app.",
  );
}

function adminAuthorizationRequired(): Response {
  return clientV1ErrorResponse(
    "unauthorized",
    "Cave admin authorization is required.",
  );
}

function adminMutationSourceRequired(): Response {
  return clientV1ErrorResponse(
    "scope_denied",
    "Cave admin mutations require a same-origin request source.",
  );
}

function hasValidMutationSource(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url);
  } catch {
    return false;
  }
  const expectedOrigins = expectedRequestOrigins(
    requestUrl.origin,
    requestUrl.protocol,
    req.headers.get("host") ?? requestUrl.host,
  );
  return (
    isAllowedRequestSourceAny(origin, expectedOrigins)
    && isAllowedRequestSourceAny(referer, expectedOrigins)
  );
}

export function requireClientV1Admin(
  req: Request,
  options: { mutation?: boolean } = {},
): Response | null {
  // The listener's loopback stamp proves transport locality, not the Cave
  // administrator. Packaged Cave therefore requires its configured per-launch
  // sidecar credential. Tokenless browser development has no such credential,
  // so proxy() converts its verified direct-loopback decision into a separate,
  // secret-valued admin marker after stripping any caller-supplied value.
  //
  // Locality is now required as well, one layer up: proxy() answers
  // `403 forbidden peer: client v1 admin requires direct loopback` for
  // /api/client/v1/admin/* that is not a direct loopback peer (#4843). That is
  // the layer that can see it — the stamp is meaningful only next to
  // `remoteIngress`, which is assembled from the mobile and sidecar gates and
  // is not visible from here. The two checks answer different questions: this
  // one asks WHO, the proxy asks FROM WHERE. Before the proxy gate existed, a
  // forwarded caller holding the sidecar token and sending no Origin/Referer
  // could read the credential list and the pending-pairing queue from off the
  // machine.
  const secret = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
  if (!secret) {
    const localPeerSecret = process.env.COVEN_CAVE_LOCAL_PEER_SECRET?.trim();
    const suppliedLocalAdmin = req.headers.get(CLIENT_V1_ADMIN_HEADER);
    if (
      process.env.COVEN_CAVE_BUNDLE !== "1"
      && localPeerSecret
      && suppliedLocalAdmin
      && timingSafeEqualString(suppliedLocalAdmin, localPeerSecret)
    ) {
      return options.mutation && !hasValidMutationSource(req)
        ? adminMutationSourceRequired()
        : null;
    }
    return adminAuthorizationUnavailable();
  }

  const supplied = req.headers.get(TOKEN_HEADER);
  if (!supplied || !timingSafeEqualString(supplied, secret)) {
    return adminAuthorizationRequired();
  }
  if (options.mutation && !hasValidMutationSource(req)) {
    return adminMutationSourceRequired();
  }
  return null;
}
