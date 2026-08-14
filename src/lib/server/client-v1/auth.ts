// Route-level bearer authentication for the `/api/client/v1` facade
// (non-admin routes only — admin routes never accept client bearer auth and
// keep using the existing sidecar-token + Cave UI gates).
//
// A route handler calls `requireClientPrincipal(req, requiredScopeOrScopes)`
// exactly once, before doing anything else with the request. It returns a
// discriminated result so a caller can never accidentally treat a failure as
// a success:
//
//   const auth = await requireClientPrincipal(req, "chat:read");
//   if (!auth.ok) return auth.response;
//   const { principal } = auth;
//
// Every check below is deliberately ordered identity -> authorization ->
// throttling -> bookkeeping:
//
//   1. the unforgeable internal marker (proves proxy.ts already verified a
//      direct loopback peer for this request; see proxy.ts and
//      CLIENT_V1_LOCAL_HEADER in proxy-helpers.ts), verified via the shared
//      constant-time `isTrustedLocalPeer` helper — never a direct string
//      comparison, which would leak timing information about how much of the
//      secret a guess got right.
//   2. a syntactically valid bearer token
//   3. the token verifies against a live, unrevoked credential
//   4. that credential carries the EXACT scope the route requires
//   5. the authenticated rate limit, keyed by credential id (so a flood of
//      invalid tokens can never consume a real client's throttle budget —
//      steps 2-4 must succeed first)
//   6. `recordCredentialUse`'s write-throttled "last used" bookkeeping —
//      purely informational, and never allowed to turn an otherwise-successful
//      authorization into a failure (see the comment at that step)
//
// Every failure response uses the shared `clientV1Error` envelope and a
// fixed, generic message — none of them describe WHY a marker or token
// failed, so a caller (or anyone reading a log of these responses) can never
// distinguish "wrong marker" from "no marker" from "expired secret", etc.

import { CLIENT_V1_LOCAL_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import type { ClientV1Scope } from "./contract.ts";
import { clientV1Error } from "./responses.ts";
import {
  recordCredentialUse as defaultRecordCredentialUse,
  verifyCredential as defaultVerifyCredential,
  type SafeClientCredential,
} from "./credential-store.ts";
import { consumeClientV1AuthenticatedLimit, type RateLimitResult } from "./rate-limit.ts";

/** Everything a route may safely know about the caller. Never the bearer, its hash, or the marker. */
export type ClientPrincipal = {
  readonly credentialId: string;
  readonly appName: string;
  readonly installationId: string;
  readonly scopes: readonly ClientV1Scope[];
};

export type ClientAuthSuccess = { ok: true; principal: ClientPrincipal };
export type ClientAuthFailure = { ok: false; response: Response };
export type ClientAuthResult = ClientAuthSuccess | ClientAuthFailure;
export type RequiredClientScope = ClientV1Scope | readonly ClientV1Scope[];

const UNAUTHORIZED_MESSAGE = "Not authorized.";
const SCOPE_DENIED_MESSAGE = "This credential does not grant the required scope.";
const RATE_LIMITED_MESSAGE = "Too many requests. Please slow down and try again.";

// Exactly `Bearer <token>`: one or more spaces after the scheme, then one
// run of non-whitespace characters, then nothing else. A second token
// (`Bearer a b`), a bare scheme (`Bearer`), or an all-whitespace remainder
// (`Bearer   `) are all malformed and fall through to null.
const BEARER_RE = /^Bearer +(\S+)$/;

function parseBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = BEARER_RE.exec(header);
  return match ? match[1] : null;
}

function toPrincipal(credential: SafeClientCredential): ClientPrincipal {
  return {
    credentialId: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    // Cloned so a caller mutating the returned principal's `scopes` can never
    // reach back into the credential store's own copy.
    scopes: [...credential.scopes],
  };
}

function requiredScopes(required: RequiredClientScope): readonly ClientV1Scope[] {
  if (Array.isArray(required)) return [...required];
  return [required as ClientV1Scope];
}

function unauthorized(): Response {
  return clientV1Error(401, "unauthorized", UNAUTHORIZED_MESSAGE, false);
}

function forbiddenMarker(): Response {
  // 403, not 401: the marker is a proxy-internal proof, not a caller
  // credential — no bearer token could ever satisfy it, so retrying with a
  // different Authorization header would never help.
  return clientV1Error(403, "unauthorized", UNAUTHORIZED_MESSAGE, false);
}

function scopeDenied(): Response {
  return clientV1Error(403, "scope_denied", SCOPE_DENIED_MESSAGE, false);
}

function rateLimited(result: Extract<RateLimitResult, { allowed: false }>): Response {
  const response = clientV1Error(429, "rate_limited", RATE_LIMITED_MESSAGE, true);
  response.headers.set("Retry-After", String(result.retryAfterSeconds));
  return response;
}

/**
 * Logs a `recordCredentialUse` failure so it is never silently swallowed —
 * but deliberately as a FIXED, secret-free diagnostic string. Unlike
 * `credential-transaction-lock.ts`'s `logCleanupFailure`, this never
 * interpolates the thrown error's own message (or `String(error)`, or the
 * credential id, or any other value derived from the failure): a storage
 * error could plausibly embed a file path containing the bearer token or
 * credential id (e.g. a future on-disk layout keyed by token), so the only
 * safe diagnostic is one that carries no data from the failure at all.
 */
function logRecordUseFailure(): void {
  console.error("[client-v1 auth] recordCredentialUse failed for an already-verified credential");
}

/** The dependencies `requireClientPrincipal` needs, injectable for deterministic tests. */
export type ClientAuthDeps = {
  /** Reads the per-boot secret proxy.ts stamped the internal marker with. */
  localPeerSecret: () => string | undefined;
  verifyCredential: (token: string, now?: number) => Promise<SafeClientCredential | null>;
  recordCredentialUse: (id: string, now?: number) => Promise<void>;
  consumeAuthenticatedRateLimit: (credentialId: string, now?: number) => RateLimitResult;
  now: () => number;
};

function defaultDeps(): ClientAuthDeps {
  return {
    localPeerSecret: () => process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
    verifyCredential: defaultVerifyCredential,
    recordCredentialUse: defaultRecordCredentialUse,
    consumeAuthenticatedRateLimit: consumeClientV1AuthenticatedLimit,
    now: () => Date.now(),
  };
}

/**
 * Builds a `requireClientPrincipal` function closed over `deps` (falling back
 * to the real credential store / rate limiter / clock for anything not
 * overridden). Production code should use the default export below; tests
 * that need deterministic control over the store, the limiter, or the clock
 * should build their own authorizer with `createClientAuthorizer({ ... })`
 * rather than reaching for ESM module mocking.
 */
export function createClientAuthorizer(overrides: Partial<ClientAuthDeps> = {}) {
  const deps: ClientAuthDeps = { ...defaultDeps(), ...overrides };

  return async function requireClientPrincipal(
    req: Request,
    requiredScope: RequiredClientScope,
  ): Promise<ClientAuthResult> {
    // 1. The unforgeable internal marker. Any caller-supplied header value is
    // compared, never trusted outright — a constant-time equality check
    // against the real per-boot secret (via the shared `isTrustedLocalPeer`
    // helper, never a direct `===` comparison) is the only thing that can
    // pass, and proxy.ts has already stripped any client-supplied copy
    // before ever stamping its own, so a mismatch here means either this
    // request never went through proxy.ts's loopback branch or the marker is
    // forged.
    const markerOk = isTrustedLocalPeer(req.headers.get(CLIENT_V1_LOCAL_HEADER), deps.localPeerSecret());
    if (!markerOk) {
      return { ok: false, response: forbiddenMarker() };
    }

    const now = deps.now();

    // 2. A syntactically valid bearer token.
    const token = parseBearerToken(req);
    if (!token) {
      return { ok: false, response: unauthorized() };
    }

    // 3. The token verifies against a live, unrevoked credential.
    const credential = await deps.verifyCredential(token, now);
    if (!credential) {
      return { ok: false, response: unauthorized() };
    }

    // 4. Exact scope check — a credential scoped to `chat:read` never
    // satisfies a route that requires `chat:write`, and a route that requires
    // multiple scopes must have ALL of them before it may proceed. The failure
    // is intentionally generic: never reveal which specific scope was missing.
    if (requiredScopes(requiredScope).some((scope) => !credential.scopes.includes(scope))) {
      return { ok: false, response: scopeDenied() };
    }

    // 5. The authenticated rate limit, keyed by credential id — only reached
    // once identity AND scope are both proven, so a flood of invalid tokens
    // or under-scoped credentials can never consume a real client's budget.
    const limitResult = deps.consumeAuthenticatedRateLimit(credential.id, now);
    if (!limitResult.allowed) {
      return { ok: false, response: rateLimited(limitResult) };
    }

    // 6. Record the use. `recordCredentialUse`'s own write throttle keeps a
    // chatty client from causing a disk write on every request. This step is
    // purely informational bookkeeping — `lastUsedAt` — layered on top of a
    // credential whose live, unrevoked, correctly-scoped persisted record was
    // already verified above (steps 3-4). A write failure here does not
    // un-verify that record, so it must never turn an otherwise-successful
    // authorization into a failure for the caller: the authority decision
    // stays based on the verified persisted credential, not on whether this
    // best-effort timestamp write happened to succeed. The failure is still
    // never silently swallowed — it is always surfaced as a fixed, secret-free
    // internal diagnostic (never the thrown error's own message, the token,
    // its hash, the credential id, or any other value derived from the
    // failure) so a genuinely broken store is still observable in logs.
    try {
      await deps.recordCredentialUse(credential.id, now);
    } catch {
      logRecordUseFailure();
    }

    return { ok: true, principal: toPrincipal(credential) };
  };
}

/** The production authorizer: real credential store, real rate limiter, real clock. */
export const requireClientPrincipal = createClientAuthorizer();
