import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  CLIENT_V1_HPKE_FRESHNESS,
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_MECHANISM,
  type ClientV1HpkeAuthorization,
  type ClientV1HpkeAuthority,
} from "./authority-contract.ts";
import type {
  ClientV1AuthorityReplayCache,
  ClientV1AuthorityReplayResult,
} from "./authority-replay.ts";
import {
  createClientV1AuthorityRuntimeFromGlobal,
  type ClientV1AuthorityBootstrap,
  type ClientV1AuthorityBootstrapState,
} from "./authority-runtime.ts";
import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  type ClientV1ErrorEnvelope,
  type ClientV1Operation,
} from "./contract.ts";
import {
  base64UrlEncode,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  createClientV1HpkeSuite,
} from "./hpke-bound-v1.ts";
import {
  CLIENT_V1_OPERATION_DEFINITIONS,
  clientV1Operation,
} from "./operations.ts";
import {
  clientV1Error,
} from "./responses.ts";
import {
  createClientV1HpkeTestClient,
  type ClientV1HpkeTestClient,
} from "./testing/hpke-client.ts";

const TEST_INSTANCE_ID = "authority-runtime-test-instance";
const TEST_PAIRING_SECRET = base64UrlEncode(new Uint8Array(32).fill(0x31));
const TEST_BEARER = "authority-runtime-test-bearer";
const TEST_NOW = 200_000;
const previousInstanceId = process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;

process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = TEST_INSTANCE_ID;
after(() => {
  if (previousInstanceId === undefined) {
    delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  } else {
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = previousInstanceId;
  }
});

async function createBootstrap(
  mode: "advertise" | "enforce",
  seed = 1,
): Promise<ClientV1AuthorityBootstrap> {
  const suite = createClientV1HpkeSuite();
  const keyPair = await suite.kem.deriveKeyPair(new Uint8Array(32).fill(seed));
  const publicKey = await clientV1HpkePublicKey(suite, keyPair.publicKey);
  return {
    mode,
    suite,
    keyPair,
    publicKey,
    keyId: clientV1HpkeKeyId(publicKey),
    runtimeNonce: new Uint8Array(32).fill(seed + 32),
  };
}

function withBootstrap<T>(
  state: ClientV1AuthorityBootstrapState | undefined,
  action: () => T,
): T {
  const previous = globalThis.__covenCaveClientV1AuthorityBootstrap;
  if (state === undefined) {
    delete globalThis.__covenCaveClientV1AuthorityBootstrap;
  } else {
    globalThis.__covenCaveClientV1AuthorityBootstrap = state;
  }
  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete globalThis.__covenCaveClientV1AuthorityBootstrap;
    } else {
      globalThis.__covenCaveClientV1AuthorityBootstrap = previous;
    }
  }
}

function publicAuthority(
  bootstrap: ClientV1AuthorityBootstrap,
): ClientV1HpkeAuthority {
  return {
    mechanism: CLIENT_V1_HPKE_MECHANISM,
    mode: bootstrap.mode,
    keyId: base64UrlEncode(bootstrap.keyId),
    publicKey: base64UrlEncode(bootstrap.publicKey),
    suite: {
      kemId: 32,
      kdfId: 1,
      aeadId: 2,
    },
  };
}

function operationRequestDetails(operation: ClientV1Operation): {
  method: string;
  url: string;
} {
  switch (operation) {
    case "pairing.poll":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/pairing/requests/pair-1",
      };
    case "pairing.exchange":
      return {
        method: "POST",
        url: "http://127.0.0.1:3020/api/client/v1/pairing/requests/pair-1/exchange",
      };
    case "familiars.list":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/familiars",
      };
    case "projects.list":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/projects",
      };
    case "conversations.list":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/conversations",
      };
    case "conversations.read":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/conversations/conversation-1",
      };
    case "messages.list":
      return {
        method: "GET",
        url: "http://127.0.0.1:3020/api/client/v1/conversations/conversation-1/messages",
      };
    default:
      throw new Error(`Test operation ${operation} is not HPKE-bound.`);
  }
}

function authorizationFor(
  operation: ClientV1Operation,
): ClientV1HpkeAuthorization {
  const credential = clientV1Operation(operation)?.credential;
  if (credential === "pairing-secret") {
    return { kind: "pairing-secret", value: TEST_PAIRING_SECRET };
  }
  if (credential === "bearer") {
    return { kind: "bearer", value: TEST_BEARER };
  }
  throw new Error(`Test operation ${operation} has no bound credential.`);
}

async function createBoundClient(input: {
  bootstrap: ClientV1AuthorityBootstrap;
  operation?: ClientV1Operation;
  authorization?: ClientV1HpkeAuthorization;
  issuedAt?: number;
  body?: Uint8Array;
  requestNonceByte?: number;
}): Promise<ClientV1HpkeTestClient> {
  const operation = input.operation ?? "projects.list";
  const { method, url } = operationRequestDetails(operation);
  return createClientV1HpkeTestClient({
    authority: publicAuthority(input.bootstrap),
    instanceId: TEST_INSTANCE_ID,
    runtimeNonce: base64UrlEncode(input.bootstrap.runtimeNonce),
    operation,
    url,
    method,
    ...(input.body === undefined ? {} : { body: input.body }),
    issuedAt: input.issuedAt ?? TEST_NOW,
    requestNonce: new Uint8Array(32).fill(input.requestNonceByte ?? 7),
    authorization: input.authorization ?? authorizationFor(operation),
  });
}

function fixedError(
  code: "invalid_request" | "conflict" | "incompatible_version"
    | "internal_error" | "service_unavailable",
  message: string,
  reason: string,
  retryable = false,
): ClientV1ErrorEnvelope {
  return clientV1Error(code, message, {
    details: { reason },
    ...(retryable ? { retryable: true } : {}),
  });
}

async function assertPlainError(
  response: Response,
  status: number,
  expected: ClientV1ErrorEnvelope,
): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), expected);
}

async function openJson(
  client: ClientV1HpkeTestClient,
  response: Response,
): Promise<{
  status: number;
  retryAfter?: string;
  body: unknown;
}> {
  const opened = await client.open(response);
  return {
    status: opened.status,
    ...(opened.headers.retryAfter === undefined
      ? {}
      : { retryAfter: opened.headers.retryAfter }),
    body: JSON.parse(new TextDecoder().decode(opened.body)),
  };
}

test("off mode and non-bound operations pass the original request through unchanged", async () => {
  const off = withBootstrap(undefined, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  assert.equal(off.mode, "off");

  const legacy = new Request("http://127.0.0.1:3020/api/client/v1/projects", {
    headers: {
      authorization: `Bearer ${TEST_BEARER}`,
      [CLIENT_V1_PAIRING_SECRET_HEADER]: TEST_PAIRING_SECRET,
    },
  });
  const legacyResponse = new Response(null, { status: 204 });
  assert.equal(
    await off.handle({
      operation: "projects.list",
      request: legacy,
      invoke: async (request) => {
        assert.strictEqual(request, legacy);
        assert.equal(request.headers.get("authorization"), `Bearer ${TEST_BEARER}`);
        assert.equal(
          request.headers.get(CLIENT_V1_PAIRING_SECRET_HEADER),
          TEST_PAIRING_SECRET,
        );
        return legacyResponse;
      },
    }),
    legacyResponse,
  );

  const bootstrap = await createBootstrap("enforce");
  const active = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const health = new Request("http://127.0.0.1:3020/api/client/v1/health");
  assert.equal(
    await active.handle({
      operation: "health.read",
      request: health,
      invoke: async (request) => {
        assert.strictEqual(request, health);
        return legacyResponse;
      },
    }),
    legacyResponse,
  );
});

test("unavailable active authority fails every protected operation before marker or credential handling", async () => {
  const protectedOperations = CLIENT_V1_OPERATION_DEFINITIONS.filter(
    ({ binding }) => binding === "hpke-bound-v1",
  );

  for (const mode of ["advertise", "enforce"] as const) {
    const authority = withBootstrap({ mode, unavailable: true }, () =>
      createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
    for (const operation of protectedOperations) {
      for (const marker of [undefined, CLIENT_V1_HPKE_MECHANISM]) {
        let invocations = 0;
        const headers = new Headers(
          operation.credential === "pairing-secret"
            ? { [CLIENT_V1_PAIRING_SECRET_HEADER]: TEST_PAIRING_SECRET }
            : { authorization: `Bearer ${TEST_BEARER}` },
        );
        if (marker) headers.set(CLIENT_V1_HPKE_HEADERS.mechanism, marker);
        const response = await authority.handle({
          operation: operation.id,
          request: new Request(
            operationRequestDetails(operation.id).url,
            { method: operation.method, headers },
          ),
          invoke: async () => {
            invocations += 1;
            return new Response(null, { status: 204 });
          },
        });
        assert.equal(invocations, 0);
        await assertPlainError(
          response,
          503,
          fixedError(
            "service_unavailable",
            "Client v1 HPKE authority is unavailable.",
            "authority_unavailable",
            true,
          ),
        );
      }
    }
  }
});

test("advertise permits only an unmarked legacy fallback and enforce requires binding", async () => {
  const advertiseBootstrap = await createBootstrap("advertise", 2);
  const advertise = withBootstrap(advertiseBootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const legacy = new Request("http://127.0.0.1:3020/api/client/v1/projects", {
    headers: { authorization: `Bearer ${TEST_BEARER}` },
  });
  let invocations = 0;
  await advertise.handle({
    operation: "projects.list",
    request: legacy,
    invoke: async (request) => {
      invocations += 1;
      assert.strictEqual(request, legacy);
      return Response.json({ legacy: true });
    },
  });
  assert.equal(invocations, 1);

  const invalidMarker = new Request(legacy, {
    headers: {
      [CLIENT_V1_HPKE_HEADERS.mechanism]: "unknown-authority",
    },
  });
  await assertPlainError(
    await advertise.handle({
      operation: "projects.list",
      request: invalidMarker,
      invoke: async () => {
        invocations += 1;
        return Response.json({ legacy: true });
      },
    }),
    400,
    fixedError(
      "invalid_request",
      "Invalid authority envelope.",
      "authority_invalid",
    ),
  );
  assert.equal(invocations, 1);

  const enforceBootstrap = await createBootstrap("enforce", 3);
  const enforce = withBootstrap(enforceBootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  await assertPlainError(
    await enforce.handle({
      operation: "projects.list",
      request: legacy,
      invoke: async () => {
        invocations += 1;
        return Response.json({ legacy: true });
      },
    }),
    426,
    fixedError(
      "incompatible_version",
      "HPKE authority binding is required.",
      "hpke_binding_required",
    ),
  );
  assert.equal(invocations, 1);
});

test("present non-exact authority markers fail fixed before callbacks in advertise and enforce", async () => {
  const markerCases = [
    {
      name: "empty",
      addMarker(headers: Headers) {
        headers.set(CLIENT_V1_HPKE_HEADERS.mechanism, "");
      },
      expected: "",
    },
    {
      name: "whitespace",
      addMarker(headers: Headers) {
        headers.set(CLIENT_V1_HPKE_HEADERS.mechanism, " \t ");
      },
      expected: "",
    },
    {
      name: "case-changed",
      addMarker(headers: Headers) {
        headers.set(CLIENT_V1_HPKE_HEADERS.mechanism, "HPKE-BOUND-V1");
      },
      expected: "HPKE-BOUND-V1",
    },
    {
      name: "duplicate",
      addMarker(headers: Headers) {
        headers.append(
          CLIENT_V1_HPKE_HEADERS.mechanism,
          CLIENT_V1_HPKE_MECHANISM,
        );
        headers.append(
          CLIENT_V1_HPKE_HEADERS.mechanism,
          CLIENT_V1_HPKE_MECHANISM,
        );
      },
      expected: `${CLIENT_V1_HPKE_MECHANISM}, ${CLIENT_V1_HPKE_MECHANISM}`,
    },
    {
      name: "combined",
      addMarker(headers: Headers) {
        headers.set(
          CLIENT_V1_HPKE_HEADERS.mechanism,
          `${CLIENT_V1_HPKE_MECHANISM}, unknown-authority`,
        );
      },
      expected: `${CLIENT_V1_HPKE_MECHANISM}, unknown-authority`,
    },
  ] as const;

  for (const mode of ["advertise", "enforce"] as const) {
    const bootstrap = await createBootstrap(
      mode,
      mode === "advertise" ? 19 : 20,
    );
    const authority = withBootstrap(bootstrap, () =>
      createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));

    for (const markerCase of markerCases) {
      const headers = new Headers({
        authorization: ["Bearer", TEST_BEARER].join(" "),
        [CLIENT_V1_PAIRING_SECRET_HEADER]: TEST_PAIRING_SECRET,
      });
      markerCase.addMarker(headers);
      assert.equal(
        headers.get(CLIENT_V1_HPKE_HEADERS.mechanism),
        markerCase.expected,
        `${markerCase.name} marker must remain present in Headers`,
      );

      let invocations = 0;
      const response = await authority.handle({
        operation: "projects.list",
        request: new Request(
          "http://127.0.0.1:3020/api/client/v1/projects",
          { headers },
        ),
        invoke: async () => {
          invocations += 1;
          return Response.json({
            bearer: TEST_BEARER,
            pairingSecret: TEST_PAIRING_SECRET,
          });
        },
      });
      assert.equal(
        invocations,
        0,
        `${mode}/${markerCase.name} must not invoke the legacy callback`,
      );
      const rendered = await response.clone().text();
      assert.equal(rendered.includes(TEST_BEARER), false);
      assert.equal(rendered.includes(TEST_PAIRING_SECRET), false);
      await assertPlainError(
        response,
        400,
        fixedError(
          "invalid_request",
          "Invalid authority envelope.",
          "authority_invalid",
        ),
      );
    }
  }
});

test("valid bound requests inject exactly one credential and Auth-seal the response", async () => {
  const bootstrap = await createBootstrap("advertise", 4);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const cases = [
    {
      operation: "pairing.poll" as const,
      expectedHeader: CLIENT_V1_PAIRING_SECRET_HEADER,
      expectedValue: TEST_PAIRING_SECRET,
    },
    {
      operation: "projects.list" as const,
      expectedHeader: "authorization",
      expectedValue: `Bearer ${TEST_BEARER}`,
    },
  ];

  for (const [index, item] of cases.entries()) {
    const client = await createBoundClient({
      bootstrap,
      operation: item.operation,
      requestNonceByte: 20 + index,
    });
    const headers = new Headers(client.request.headers);
    headers.set("x-safe-header", `safe-${index}`);
    const controller = new AbortController();
    const request = new Request(client.request, {
      headers,
      signal: controller.signal,
    });
    const response = await authority.handle({
      operation: item.operation,
      request,
      invoke: async (injected) => {
        assert.equal(injected.url, request.url);
        assert.equal(injected.method, request.method);
        assert.equal(injected.signal.aborted, request.signal.aborted);
        assert.equal(await injected.arrayBuffer().then((body) => body.byteLength), 0);
        for (const header of Object.values(CLIENT_V1_HPKE_HEADERS)) {
          assert.equal(injected.headers.has(header), false);
        }
        const expectedHeaders = [
          [item.expectedHeader, item.expectedValue],
          ["x-safe-header", `safe-${index}`],
        ].sort(([left], [right]) => left.localeCompare(right));
        assert.deepEqual(
          [...injected.headers.entries()].sort(([left], [right]) =>
            left.localeCompare(right)),
          expectedHeaders,
        );
        return Response.json(
          { operation: item.operation },
          { status: 201 },
        );
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("retry-after"), false);
    assert.deepEqual(await openJson(client, response), {
      status: 201,
      body: { operation: item.operation },
    });
  }
});

test("typed HPKE open failures map to fixed plaintext responses before callbacks", async () => {
  const bootstrap = await createBootstrap("advertise", 5);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const cases: {
    name: string;
    client: ClientV1HpkeTestClient;
    mutate?: (headers: Headers) => void;
    status: number;
    expected: ClientV1ErrorEnvelope;
  }[] = [];

  const staleKey = await createBoundClient({
    bootstrap,
    requestNonceByte: 31,
  });
  cases.push({
    name: "stale-key",
    client: staleKey,
    mutate: (headers) => {
      headers.set(
        CLIENT_V1_HPKE_HEADERS.keyId,
        base64UrlEncode(new Uint8Array(32).fill(0xee)),
      );
    },
    status: 409,
    expected: fixedError(
      "conflict",
      "The Cave authority key is stale.",
      "authority_key_stale",
      true,
    ),
  });

  const staleInstance = await createBoundClient({
    bootstrap,
    requestNonceByte: 32,
  });
  cases.push({
    name: "stale-instance",
    client: staleInstance,
    mutate: (headers) => {
      headers.set(
        CLIENT_V1_HPKE_HEADERS.instanceId,
        base64UrlEncode(new TextEncoder().encode("other-instance")),
      );
    },
    status: 409,
    expected: fixedError(
      "conflict",
      "The Cave instance identity is stale.",
      "authority_instance_stale",
      true,
    ),
  });

  cases.push({
    name: "stale-request",
    client: await createBoundClient({
      bootstrap,
      issuedAt: TEST_NOW - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs - 1,
      requestNonceByte: 33,
    }),
    status: 409,
    expected: fixedError(
      "conflict",
      "The authority request is stale.",
      "authority_request_stale",
      true,
    ),
  });

  const invalid = await createBoundClient({
    bootstrap,
    requestNonceByte: 34,
  });
  cases.push({
    name: "invalid",
    client: invalid,
    mutate: (headers) => {
      headers.delete(CLIENT_V1_HPKE_HEADERS.ciphertext);
    },
    status: 400,
    expected: fixedError(
      "invalid_request",
      "Invalid authority envelope.",
      "authority_invalid",
    ),
  });

  let invocations = 0;
  for (const item of cases) {
    const headers = new Headers(item.client.request.headers);
    item.mutate?.(headers);
    const response = await authority.handle({
      operation: "projects.list",
      request: new Request(item.client.request, { headers }),
      invoke: async () => {
        invocations += 1;
        return Response.json({ unexpected: item.name });
      },
    });
    await assertPlainError(response, item.status, item.expected);
  }
  assert.equal(invocations, 0);
});

test("replay reservation is synchronous before the credential handler", async () => {
  const bootstrap = await createBootstrap("advertise", 6);
  const events: string[] = [];
  const replay: ClientV1AuthorityReplayCache = {
    reserve: () => {
      events.push("reserve");
      return { ok: true };
    },
    size: () => 0,
  };
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({
      now: () => TEST_NOW,
      replay,
    }));
  const client = await createBoundClient({
    bootstrap,
    requestNonceByte: 40,
  });
  const response = await authority.handle({
    operation: "projects.list",
    request: client.request,
    invoke: async () => {
      events.push("invoke");
      return Response.json({ ok: true });
    },
  });

  assert.deepEqual(events, ["reserve", "invoke"]);
  assert.equal((await openJson(client, response)).status, 200);
});

test("concurrent identical bound requests invoke one handler and encrypt one replay", async () => {
  const bootstrap = await createBootstrap("advertise", 7);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const client = await createBoundClient({
    bootstrap,
    requestNonceByte: 41,
  });
  let invocations = 0;
  const handle = () =>
    authority.handle({
      operation: "projects.list",
      request: client.request.clone(),
      invoke: async () => {
        invocations += 1;
        await Promise.resolve();
        return Response.json({ accepted: true });
      },
    });

  const opened = await Promise.all(
    (await Promise.all([handle(), handle()])).map((response) =>
      openJson(client, response)),
  );
  assert.equal(invocations, 1);
  assert.deepEqual(
    opened.map(({ status }) => status).sort(),
    [200, 409],
  );
  const replayed = opened.find(({ status }) => status === 409);
  assert.equal(
    (replayed?.body as ClientV1ErrorEnvelope).error.details?.reason,
    "authority_replayed",
  );
  assert.equal((replayed?.body as ClientV1ErrorEnvelope).error.retryable, true);
});

test("every non-ok reservation is encrypted and fails closed before stores or handlers", async () => {
  const cases: {
    result: ClientV1AuthorityReplayResult;
    status: number;
    reason: string;
    retryAfter?: string;
  }[] = [
    {
      result: { ok: false, reason: "stale" },
      status: 409,
      reason: "authority_request_stale",
    },
    {
      result: { ok: false, reason: "replay" },
      status: 409,
      reason: "authority_replayed",
    },
    {
      result: {
        ok: false,
        reason: "capacity",
        retryAfterSeconds: 37,
      },
      status: 503,
      reason: "authority_replay_capacity",
      retryAfter: "37",
    },
  ];

  for (const [index, item] of cases.entries()) {
    const bootstrap = await createBootstrap("advertise", 10 + index);
    const replay: ClientV1AuthorityReplayCache = {
      reserve: () => item.result,
      size: () => 0,
    };
    const authority = withBootstrap(bootstrap, () =>
      createClientV1AuthorityRuntimeFromGlobal({
        now: () => TEST_NOW,
        replay,
      }));
    const client = await createBoundClient({
      bootstrap,
      requestNonceByte: 50 + index,
    });
    let callbacks = 0;
    let storeReads = 0;
    let rateLimitReads = 0;
    let dataReads = 0;
    const response = await authority.handle({
      operation: "projects.list",
      request: client.request,
      invoke: async () => {
        callbacks += 1;
        storeReads += 1;
        rateLimitReads += 1;
        dataReads += 1;
        return Response.json({ unexpected: true });
      },
    });
    assert.equal(callbacks, 0);
    assert.equal(storeReads, 0);
    assert.equal(rateLimitReads, 0);
    assert.equal(dataReads, 0);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("retry-after"), false);
    const opened = await openJson(client, response);
    assert.equal(opened.status, item.status);
    assert.equal(opened.retryAfter, item.retryAfter);
    assert.equal(
      (opened.body as ClientV1ErrorEnvelope).error.details?.reason,
      item.reason,
    );
    assert.equal((opened.body as ClientV1ErrorEnvelope).error.retryable, true);
  }
});

test("one clock snapshot preserves the inclusive boundary and the second request replays", async () => {
  const bootstrap = await createBootstrap("advertise", 14);
  let clockReads = 0;
  const now = () => TEST_NOW + clockReads++;
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now }));
  const client = await createBoundClient({
    bootstrap,
    issuedAt: TEST_NOW - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs,
    requestNonceByte: 60,
  });
  let invocations = 0;
  const handleBoundary = () =>
    authority.handle({
      operation: "projects.list",
      request: client.request.clone(),
      invoke: async () => {
        invocations += 1;
        return Response.json({ accepted: true });
      },
    });

  clockReads = 0;
  const first = await handleBoundary();
  assert.equal(clockReads, 1);
  assert.equal(invocations, 1);
  assert.equal((await openJson(client, first)).status, 200);

  clockReads = 0;
  const second = await handleBoundary();
  assert.equal(clockReads, 1);
  assert.equal(invocations, 1);
  const opened = await openJson(client, second);
  assert.equal(opened.status, 409);
  assert.equal(
    (opened.body as ClientV1ErrorEnvelope).error.details?.reason,
    "authority_replayed",
  );
});

test("bound requests reject plaintext credentials, credential mismatches, and bodies", async () => {
  const bootstrap = await createBootstrap("advertise", 15);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  let invocations = 0;

  const plaintextHeaders = [
    ["authorization", `Bearer ${TEST_BEARER}`],
    [CLIENT_V1_PAIRING_SECRET_HEADER, TEST_PAIRING_SECRET],
  ] as const;
  for (const [index, [name, value]] of plaintextHeaders.entries()) {
    const client = await createBoundClient({
      bootstrap,
      requestNonceByte: 70 + index,
    });
    const headers = new Headers(client.request.headers);
    headers.set(name, value);
    await assertPlainError(
      await authority.handle({
        operation: "projects.list",
        request: new Request(client.request, { headers }),
        invoke: async () => {
          invocations += 1;
          return Response.json({ unexpected: true });
        },
      }),
      400,
      fixedError(
        "invalid_request",
        "Invalid authority envelope.",
        "authority_invalid",
      ),
    );
  }

  const pairingClient = await createBoundClient({
    bootstrap,
    operation: "pairing.poll",
    requestNonceByte: 72,
  });
  const mismatched = await authority.handle({
    operation: "projects.list",
    request: pairingClient.request,
    invoke: async () => {
      invocations += 1;
      return Response.json({ unexpected: true });
    },
  });
  const mismatchOpened = await openJson(pairingClient, mismatched);
  assert.equal(mismatchOpened.status, 400);
  assert.equal(
    (mismatchOpened.body as ClientV1ErrorEnvelope).error.details?.reason,
    "authority_invalid",
  );

  const bodyClient = await createBoundClient({
    bootstrap,
    operation: "pairing.exchange",
    body: new Uint8Array([1]),
    requestNonceByte: 73,
  });
  const bodyResponse = await authority.handle({
    operation: "pairing.exchange",
    request: bodyClient.request,
    invoke: async () => {
      invocations += 1;
      return Response.json({ unexpected: true });
    },
  });
  const bodyOpened = await openJson(bodyClient, bodyResponse);
  assert.equal(bodyOpened.status, 400);
  assert.equal(
    (bodyOpened.body as ClientV1ErrorEnvelope).error.details?.reason,
    "authority_invalid",
  );
  assert.equal(invocations, 0);
});

test("response sealing failures use a fixed plaintext error", async () => {
  const bootstrap = await createBootstrap("advertise", 16);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const client = await createBoundClient({
    bootstrap,
    requestNonceByte: 80,
  });
  const response = await authority.handle({
    operation: "projects.list",
    request: client.request,
    invoke: async () =>
      new Response("not-json", {
        headers: { "content-type": "text/plain" },
      }),
  });

  await assertPlainError(
    response,
    500,
    fixedError(
      "internal_error",
      "The authenticated response could not be produced.",
      "authority_response_failed",
      true,
    ),
  );
});

test("credential handler failures use a fixed response without exposing credentials", async () => {
  const bootstrap = await createBootstrap("advertise", 18);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const client = await createBoundClient({
    bootstrap,
    requestNonceByte: 81,
  });
  const response = await authority.handle({
    operation: "projects.list",
    request: client.request,
    invoke: async () => {
      throw new Error(TEST_BEARER);
    },
  });

  const rendered = JSON.stringify(await response.clone().json());
  assert.equal(rendered.includes(TEST_BEARER), false);
  await assertPlainError(
    response,
    500,
    fixedError(
      "internal_error",
      "The authenticated response could not be produced.",
      "authority_response_failed",
      true,
    ),
  );
});

test("fixed failures and diagnostics never contain plaintext credentials", async () => {
  const bootstrap = await createBootstrap("advertise", 17);
  const authority = withBootstrap(bootstrap, () =>
    createClientV1AuthorityRuntimeFromGlobal({ now: () => TEST_NOW }));
  const diagnostics: unknown[][] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...values: unknown[]) => {
    diagnostics.push(values);
  };
  console.warn = (...values: unknown[]) => {
    diagnostics.push(values);
  };

  try {
    const plaintextCredentialHeaders = [
      new Headers({
        [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
        authorization: `Bearer ${TEST_BEARER}`,
      }),
      new Headers({
        [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
        [CLIENT_V1_PAIRING_SECRET_HEADER]: TEST_PAIRING_SECRET,
      }),
    ];
    for (const headers of plaintextCredentialHeaders) {
      const response = await authority.handle({
        operation: "projects.list",
        request: new Request(
          "http://127.0.0.1:3020/api/client/v1/projects",
          { headers },
        ),
        invoke: async () => {
          throw new Error("credential handler must not run");
        },
      });
      const rendered = JSON.stringify(await response.json());
      assert.equal(rendered.includes(TEST_BEARER), false);
      assert.equal(rendered.includes(TEST_PAIRING_SECRET), false);
    }
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  const renderedDiagnostics = JSON.stringify(diagnostics);
  assert.equal(renderedDiagnostics.includes(TEST_BEARER), false);
  assert.equal(renderedDiagnostics.includes(TEST_PAIRING_SECRET), false);
  assert.deepEqual(diagnostics, []);
});
