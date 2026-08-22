import {
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
  // administrator. Only the configured per-launch sidecar credential grants
  // this route family.
  const secret = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
  if (!secret) return adminAuthorizationUnavailable();

  const supplied = req.headers.get(TOKEN_HEADER);
  if (!supplied || !timingSafeEqualString(supplied, secret)) {
    return adminAuthorizationRequired();
  }
  if (options.mutation && !hasValidMutationSource(req)) {
    return adminMutationSourceRequired();
  }
  return null;
}
