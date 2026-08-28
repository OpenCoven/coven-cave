import { timingSafeEqualString } from "../../../proxy-helpers.ts";
import type { ClientV1Scope } from "./contract.ts";
import type {
  ClientV1CredentialRecord,
  CredentialStore,
} from "./credential-store.ts";
import { ClientV1PathOwnershipError } from "./path-ownership.ts";
import {
  clientV1ErrorResponse,
  clientV1OwnershipRefusedResponse,
} from "./responses.ts";

/**
 * The outcome of one scope check.
 *
 * The failure branch carries a `reason` — and, when the caller really did
 * present a working credential, that credential — because the failures are
 * metered against different rate-limit buckets and the caller cannot tell them
 * apart from the Response alone. `unauthorized` means no credential was
 * established, so only `consumeInvalidBearer` has a key to charge;
 * `scope_denied` means an authenticated client asked for something it was not
 * granted, which belongs to that credential's `consumeAuthenticated` budget.
 * `ownership_refused` means the credential boundary could not even answer:
 * the store is not exclusively owned, which is a host condition, not a client
 * behavior, so it is metered against neither bucket.
 *
 * The alternative was for a route to branch on `response.status`, which works
 * only for as long as the canonical status map in responses.ts happens to keep
 * 401 and 403 distinct — a metering decision quietly coupled to an HTTP code.
 * The response itself is unchanged: the client still sees two normalized
 * envelopes and learns nothing extra about which bearers exist.
 */
export type ClientV1AuthResult =
  | { ok: true; credential: ClientV1CredentialRecord }
  | {
    ok: false;
    reason: "unauthorized";
    credential?: undefined;
    response: Response;
  }
  | {
    ok: false;
    reason: "scope_denied";
    credential: ClientV1CredentialRecord;
    response: Response;
  }
  | {
    ok: false;
    reason: "ownership_refused";
    credential?: undefined;
    response: Response;
  };

export interface ClientV1Authenticator {
  isTrustedLoopback(headerValue: string | null): boolean;
  requireScope(input: {
    bearer: string | null;
    scope: ClientV1Scope;
  }): Promise<ClientV1AuthResult>;
}

export interface ClientV1AuthenticatorOptions {
  credentialStore: CredentialStore;
  loopbackSecret: string;
}

function unauthorized(): ClientV1AuthResult {
  return {
    ok: false,
    reason: "unauthorized",
    response: clientV1ErrorResponse("unauthorized", "Unauthorized."),
  };
}

export function createClientV1Authenticator({
  credentialStore,
  loopbackSecret,
}: ClientV1AuthenticatorOptions): ClientV1Authenticator {
  return {
    isTrustedLoopback(headerValue) {
      return Boolean(
        headerValue
        && loopbackSecret
        && timingSafeEqualString(headerValue, loopbackSecret),
      );
    },

    async requireScope({ bearer, scope }) {
      if (!bearer) return unauthorized();
      let credential: ClientV1CredentialRecord | null;
      try {
        credential = await credentialStore.findByBearer(bearer);
      } catch (error) {
        // The store could not even be read because the host cannot verify
        // exclusive ownership of it. That is a server-host condition the
        // client cannot fix, so it is answered as its own normalized code
        // instead of letting the throw escape into a bare 500 (cave-e7xwk).
        if (error instanceof ClientV1PathOwnershipError) {
          return {
            ok: false,
            reason: "ownership_refused",
            response: clientV1OwnershipRefusedResponse(),
          };
        }
        throw error;
      }
      if (!credential) return unauthorized();
      if (!credential.scopes.includes(scope)) {
        return {
          ok: false,
          reason: "scope_denied",
          credential,
          response: clientV1ErrorResponse(
            "scope_denied",
            "The credential does not grant the required scope.",
          ),
        };
      }
      return { ok: true, credential };
    },
  };
}
