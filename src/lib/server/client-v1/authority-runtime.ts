import type { CipherSuite } from "@hpke/core";

import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  type ClientV1AuthorityMode,
} from "./authority-contract.ts";
import {
  createClientV1AuthorityReplayCache,
  type ClientV1AuthorityReplayCache,
} from "./authority-replay.ts";
import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  type ClientV1Operation,
} from "./contract.ts";
import {
  ClientV1HpkeBoundRequestError,
  concatBytes,
  openClientV1HpkeBoundRequest,
  sealClientV1HpkeBoundResponse,
  type ClientV1HpkeBoundRequestErrorKind,
  type OpenedClientV1HpkeRequest,
} from "./hpke-bound-v1.ts";
import { clientV1Operation } from "./operations.ts";
import {
  clientV1AuthorityInvalidResponse,
  clientV1AuthorityRequiredResponse,
  clientV1AuthorityResponseFailure,
  clientV1AuthorityStaleInstanceResponse,
  clientV1AuthorityStaleKeyResponse,
  clientV1AuthorityStaleRequestResponse,
  clientV1AuthorityUnavailableResponse,
  clientV1ErrorResponse,
} from "./responses.ts";

export type ClientV1AuthorityBootstrap = {
  mode: "advertise" | "enforce";
  suite: CipherSuite;
  keyPair: CryptoKeyPair;
  publicKey: Uint8Array;
  keyId: Uint8Array;
  runtimeNonce: Uint8Array;
};

export type ClientV1AuthorityBootstrapState =
  | ClientV1AuthorityBootstrap
  | {
    mode: "advertise" | "enforce";
    unavailable: true;
  };

declare global {
  var __covenCaveClientV1AuthorityBootstrap:
    | ClientV1AuthorityBootstrapState
    | undefined;
}

export interface ClientV1AuthorityRuntime {
  readonly mode: ClientV1AuthorityMode;
  handle(input: {
    operation: ClientV1Operation;
    request: Request;
    invoke: (request: Request) => Promise<Response>;
  }): Promise<Response>;
}

export interface ClientV1AuthorityRuntimeFactoryOptions {
  now: () => number;
  replay?: ClientV1AuthorityReplayCache;
}

const clientV1AuthorityOpenErrorResponses = {
  "stale-key": clientV1AuthorityStaleKeyResponse,
  "stale-instance": clientV1AuthorityStaleInstanceResponse,
  "stale-request": clientV1AuthorityStaleRequestResponse,
  invalid: clientV1AuthorityInvalidResponse,
} satisfies Record<
  ClientV1HpkeBoundRequestErrorKind,
  () => Response
>;

async function readBoundedRequestBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || !Number.isSafeInteger(parsed)
      || parsed > CLIENT_V1_HPKE_LIMITS.requestBodyBytes
    ) {
      throw new Error("Invalid Client v1 authority request body.");
    }
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CLIENT_V1_HPKE_LIMITS.requestBodyBytes) {
        await reader.cancel();
        throw new Error("Invalid Client v1 authority request body.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(...chunks);
}

async function sealAuthorityResponse(input: {
  bootstrap: ClientV1AuthorityBootstrap;
  opened: OpenedClientV1HpkeRequest;
  responsePublicKey: CryptoKey;
  response: Response;
}): Promise<Response> {
  try {
    return await sealClientV1HpkeBoundResponse({
      suite: input.bootstrap.suite,
      senderKey: input.bootstrap.keyPair.privateKey,
      responsePublicKey: input.responsePublicKey,
      binding: input.opened.binding,
      response: input.response,
    });
  } catch {
    return clientV1AuthorityResponseFailure();
  }
}

function replayFailureResponse(
  reservation: Exclude<
    ReturnType<ClientV1AuthorityReplayCache["reserve"]>,
    { ok: true }
  >,
): Response {
  switch (reservation.reason) {
    case "stale":
      return clientV1AuthorityStaleRequestResponse();
    case "replay":
      return clientV1ErrorResponse(
        "conflict",
        "The authority request was already used.",
        {
          details: { reason: "authority_replayed" },
          retryable: true,
        },
      );
    case "capacity":
      return clientV1ErrorResponse(
        "service_unavailable",
        "The authority replay window is full.",
        {
          details: { reason: "authority_replay_capacity" },
          headers: {
            "retry-after": String(reservation.retryAfterSeconds),
          },
          retryable: true,
        },
      );
  }
}

function rebuildAuthorizedRequest(input: {
  request: Request;
  opened: OpenedClientV1HpkeRequest;
}): Request {
  const headers = new Headers(input.request.headers);
  for (const header of Object.values(CLIENT_V1_HPKE_HEADERS)) {
    headers.delete(header);
  }
  headers.delete("authorization");
  headers.delete(CLIENT_V1_PAIRING_SECRET_HEADER);

  if (input.opened.authorization.kind === "pairing-secret") {
    headers.set(
      CLIENT_V1_PAIRING_SECRET_HEADER,
      input.opened.authorization.value,
    );
  } else {
    headers.set(
      "authorization",
      `Bearer ${input.opened.authorization.value}`,
    );
  }

  return new Request(input.request.url, {
    method: input.request.method,
    headers,
    signal: input.request.signal,
  });
}

export function createClientV1AuthorityRuntimeFromGlobal({
  now,
  replay = createClientV1AuthorityReplayCache(),
}: ClientV1AuthorityRuntimeFactoryOptions): ClientV1AuthorityRuntime {
  const bootstrap = globalThis.__covenCaveClientV1AuthorityBootstrap;
  if (bootstrap === undefined) {
    return {
      mode: "off",
      handle: ({ request, invoke }) => invoke(request),
    };
  }

  const mode = bootstrap.mode;
  return {
    mode,
    async handle(input): Promise<Response> {
      const operation = clientV1Operation(input.operation);
      if (!operation || operation.binding !== "hpke-bound-v1") {
        return input.invoke(input.request);
      }
      if ("unavailable" in bootstrap) {
        return clientV1AuthorityUnavailableResponse();
      }

      const marker = input.request.headers.get(
        CLIENT_V1_HPKE_HEADERS.mechanism,
      );
      if (marker === null) {
        if (mode === "advertise") return input.invoke(input.request);
        return clientV1AuthorityRequiredResponse();
      }
      if (marker !== CLIENT_V1_HPKE_MECHANISM) {
        return clientV1AuthorityInvalidResponse();
      }
      if (
        input.request.headers.has("authorization")
        || input.request.headers.has(CLIENT_V1_PAIRING_SECRET_HEADER)
      ) {
        return clientV1AuthorityInvalidResponse();
      }

      let body: Uint8Array;
      try {
        body = await readBoundedRequestBody(input.request);
      } catch {
        return clientV1AuthorityInvalidResponse();
      }

      const { clientV1InstanceId } = await import("./instance-id.ts");
      const expectedInstanceId = clientV1InstanceId();
      const requestNow = now();
      let opened: OpenedClientV1HpkeRequest;
      try {
        opened = await openClientV1HpkeBoundRequest({
          suite: bootstrap.suite,
          recipientKey: bootstrap.keyPair.privateKey,
          request: input.request,
          body,
          expectedKeyId: bootstrap.keyId,
          expectedRuntimeNonce: bootstrap.runtimeNonce,
          expectedInstanceId,
          now: requestNow,
        });
      } catch (error) {
        if (!(error instanceof ClientV1HpkeBoundRequestError)) {
          return clientV1AuthorityInvalidResponse();
        }
        return clientV1AuthorityOpenErrorResponses[error.kind]();
      }

      let responsePublicKey: CryptoKey;
      try {
        responsePublicKey =
          await bootstrap.suite.kem.deserializePublicKey(
            opened.responsePublicKeyBytes,
          );
      } catch {
        return clientV1AuthorityInvalidResponse();
      }
      if (opened.authorization.kind !== operation.credential) {
        return sealAuthorityResponse({
          bootstrap,
          opened,
          responsePublicKey,
          response: clientV1AuthorityInvalidResponse(),
        });
      }
      if (body.byteLength !== 0) {
        return sealAuthorityResponse({
          bootstrap,
          opened,
          responsePublicKey,
          response: clientV1AuthorityInvalidResponse(),
        });
      }

      let authorizedRequest: Request;
      try {
        authorizedRequest = rebuildAuthorizedRequest({
          request: input.request,
          opened,
        });
      } catch {
        return sealAuthorityResponse({
          bootstrap,
          opened,
          responsePublicKey,
          response: clientV1AuthorityInvalidResponse(),
        });
      }

      const reservation = replay.reserve(opened.binding, requestNow);
      if (!reservation.ok) {
        return sealAuthorityResponse({
          bootstrap,
          opened,
          responsePublicKey,
          response: replayFailureResponse(reservation),
        });
      }
      let response: Response;
      try {
        response = await input.invoke(authorizedRequest);
      } catch {
        return clientV1AuthorityResponseFailure();
      }
      return sealAuthorityResponse({
        bootstrap,
        opened,
        responsePublicKey,
        response,
      });
    },
  };
}
