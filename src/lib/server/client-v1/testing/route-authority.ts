import {
  CLIENT_V1_HPKE_MECHANISM,
  type ClientV1HpkeAuthority,
} from "../authority-contract.ts";
import {
  createClientV1AuthorityRuntimeFromGlobal,
  type ClientV1AuthorityBootstrap,
  type ClientV1AuthorityBootstrapState,
  type ClientV1AuthorityRuntime,
} from "../authority-runtime.ts";
import {
  base64UrlEncode,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  createClientV1HpkeSuite,
} from "../hpke-bound-v1.ts";

export type ClientV1HpkeRouteTestAuthority = {
  authority: ClientV1HpkeAuthority;
  runtime: ClientV1AuthorityRuntime;
  runtimeNonce: string;
};

export async function withClientV1HpkeRouteTestAuthority<T>(
  input: {
    instanceId: string;
    now: number;
    seed: number;
    mode?: "advertise" | "enforce";
  },
  action: (authority: ClientV1HpkeRouteTestAuthority) => Promise<T>,
): Promise<T> {
  const suite = createClientV1HpkeSuite();
  const keyPair = await suite.kem.deriveKeyPair(
    new Uint8Array(32).fill(input.seed),
  );
  const publicKey = await clientV1HpkePublicKey(suite, keyPair.publicKey);
  const keyId = clientV1HpkeKeyId(publicKey);
  const runtimeNonceBytes = new Uint8Array(32).fill(input.seed + 32);
  const bootstrap: ClientV1AuthorityBootstrap = {
    mode: input.mode ?? "enforce",
    suite,
    keyPair,
    publicKey,
    keyId,
    runtimeNonce: runtimeNonceBytes,
  };
  const previousBootstrap: ClientV1AuthorityBootstrapState | undefined =
    globalThis.__covenCaveClientV1AuthorityBootstrap;
  const previousInstanceId =
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  globalThis.__covenCaveClientV1AuthorityBootstrap = bootstrap;
  process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = input.instanceId;
  const runtime = createClientV1AuthorityRuntimeFromGlobal({
    now: () => input.now,
  });
  if (previousBootstrap === undefined) {
    delete globalThis.__covenCaveClientV1AuthorityBootstrap;
  } else {
    globalThis.__covenCaveClientV1AuthorityBootstrap = previousBootstrap;
  }

  try {
    return await action({
      authority: {
        mechanism: CLIENT_V1_HPKE_MECHANISM,
        mode: bootstrap.mode,
        keyId: base64UrlEncode(keyId),
        publicKey: base64UrlEncode(publicKey),
        suite: { kemId: 32, kdfId: 1, aeadId: 2 },
      },
      runtime,
      runtimeNonce: base64UrlEncode(runtimeNonceBytes),
    });
  } finally {
    if (previousBootstrap === undefined) {
      delete globalThis.__covenCaveClientV1AuthorityBootstrap;
    } else {
      globalThis.__covenCaveClientV1AuthorityBootstrap = previousBootstrap;
    }
    if (previousInstanceId === undefined) {
      delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
    } else {
      process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = previousInstanceId;
    }
  }
}
