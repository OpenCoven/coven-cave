import { timingSafeEqualString } from "../../../proxy-helpers.ts";
import type { ClientV1Scope } from "./contract.ts";
import type {
  ClientV1CredentialRecord,
  CredentialStore,
} from "./credential-store.ts";
import { clientV1ErrorResponse } from "./responses.ts";

export type ClientV1AuthResult =
  | { ok: true; credential: ClientV1CredentialRecord }
  | { ok: false; response: Response };

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
      const credential = await credentialStore.findByBearer(bearer);
      if (!credential) return unauthorized();
      if (!credential.scopes.includes(scope)) {
        return {
          ok: false,
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
