import {
  CLIENT_V1_LOCAL_HEADER,
  timingSafeEqualString,
} from "@/proxy-helpers";

import type { ClientV1Scope } from "./contract.ts";
import {
  verifyCredential,
  type ClientCredentialMetadata,
} from "./credential-store.ts";
import { consumeClientV1RateLimit } from "./rate-limit.ts";
import { clientV1Error } from "./responses.ts";

export type ClientV1PrincipalResult =
  | { ok: true; principal: ClientCredentialMetadata }
  | { ok: false; response: ReturnType<typeof clientV1Error> };

function unauthorized(): ClientV1PrincipalResult {
  return {
    ok: false,
    response: clientV1Error(
      401,
      "unauthorized",
      "A valid client bearer token is required.",
      false,
    ),
  };
}

function hasTrustedLocalMarker(request: Request): boolean {
  const expected = process.env.COVEN_CAVE_LOCAL_PEER_SECRET;
  const supplied = request.headers.get(CLIENT_V1_LOCAL_HEADER);
  if (!expected || !supplied) return false;
  return timingSafeEqualString(supplied, expected);
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

export async function requireClientPrincipal(
  request: Request,
  requiredScope: ClientV1Scope,
  now = Date.now(),
): Promise<ClientV1PrincipalResult> {
  if (!hasTrustedLocalMarker(request)) return unauthorized();

  const token = bearerToken(request);
  if (!token) return unauthorized();

  const principal = await verifyCredential(token, now);
  if (!principal) return unauthorized();

  if (!principal.scopes.includes(requiredScope)) {
    return {
      ok: false,
      response: clientV1Error(
        403,
        "scope_denied",
        `The client credential does not grant ${requiredScope}.`,
        false,
      ),
    };
  }

  const rateLimit = consumeClientV1RateLimit(
    "authenticated",
    principal.id,
    now,
  );
  if (!rateLimit.allowed) {
    const response = clientV1Error(
      429,
      "rate_limited",
      "The authenticated client request limit was exceeded.",
      true,
      {
        details: {
          limit: String(rateLimit.limit),
          resetAt: String(rateLimit.resetAt),
          retryAfterSeconds: String(rateLimit.retryAfterSeconds),
        },
      },
    );
    response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
    return { ok: false, response };
  }

  return { ok: true, principal };
}
