import {
  createClientV1Authenticator,
  type ClientV1Authenticator,
} from "./auth.ts";
import {
  createCredentialStore,
  type CredentialStore,
} from "./credential-store.ts";
import {
  createPairingStore,
  type PairingStore,
} from "./pairing-store.ts";
import {
  createClientV1RateLimiter,
  type ClientV1RateLimiter,
} from "./rate-limit.ts";

export interface ClientV1Runtime {
  authenticator: ClientV1Authenticator;
  credentialStore: CredentialStore;
  now: () => number;
  pairingStore: PairingStore;
  rateLimiter: ClientV1RateLimiter;
}

export interface ClientV1RuntimeOptions {
  credentialRoot?: string;
  loopbackSecret?: string;
  now?: () => number;
}

export function createClientV1Runtime(
  options: ClientV1RuntimeOptions = {},
): ClientV1Runtime {
  const now = options.now ?? Date.now;
  const credentialStore = createCredentialStore({
    ...(options.credentialRoot ? { root: options.credentialRoot } : {}),
    now,
  });
  const pairingStore = createPairingStore({ now });
  const rateLimiter = createClientV1RateLimiter({ now });
  const authenticator = createClientV1Authenticator({
    credentialStore,
    loopbackSecret:
      options.loopbackSecret ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET ?? "",
  });
  return {
    authenticator,
    credentialStore,
    now,
    pairingStore,
    rateLimiter,
  };
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __covenCaveClientV1Runtime?: ClientV1Runtime;
};

export function getClientV1Runtime(): ClientV1Runtime {
  runtimeGlobal.__covenCaveClientV1Runtime ??= createClientV1Runtime();
  return runtimeGlobal.__covenCaveClientV1Runtime;
}
