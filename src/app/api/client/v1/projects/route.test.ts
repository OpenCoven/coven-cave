import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import canonicalize from "canonicalize";

import type { CaveProject } from "@/lib/cave-projects-types.ts";
import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import {
  CLIENT_V1_HPKE_RESPONSE_INFO,
  base64UrlEncode,
  createClientV1HpkeSuite,
} from "@/lib/server/client-v1/hpke-bound-v1.ts";
import { encodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import {
  createClientV1HpkeTestClient,
  type ClientV1HpkeTestClient,
} from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ProjectsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-projects-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-projects-route-test";
const BOUND_NOW = 40_000;

function project(id: string, createdAt: string): CaveProject {
  return {
    id,
    name: `Project ${id}`,
    root: `/Users/me/code/${id}`,
    createdAt,
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

// createdAt ascending alpha < bravo = delta, and every updatedAt identical, so
// the two orderings agree until something is touched.
const REGISTRY: CaveProject[] = [
  project("alpha", "2026-08-01T00:00:00.000Z"),
  project("bravo", "2026-08-03T00:00:00.000Z"),
  project("delta", "2026-08-03T00:00:00.000Z"),
];

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: unsupported,
    listProjects: async () => REGISTRY,
    listConversations: unsupported,
    loadConversation: unsupported,
    ...overrides,
  };
}

function request(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3020/api/client/v1/projects${query}`, {
    headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers },
  });
}

async function openBoundJson(
  prepared: ClientV1HpkeTestClient,
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  );
  const inner = await prepared.open(response);
  return {
    status: inner.status,
    body: JSON.parse(new TextDecoder().decode(inner.body)) as
      Record<string, unknown>,
  };
}

async function withRuntime<T>(
  scopes: ("chat:read" | "chat:write")[],
  body: (runtime: ClientV1Runtime, bearer: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: STAMP });
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes,
    });
    return await body(runtime, issued.bearer);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("projects are served newest-created first with the id breaking a tie", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(runtime, sources());
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      capabilities: string[];
      data: { projects: Record<string, unknown>[] };
    };
    // bravo and delta share a createdAt; the id tiebreak is descending, so
    // delta precedes bravo and the ordering is total.
    assert.deepEqual(body.data.projects.map((row) => row.id), ["delta", "bravo", "alpha"]);
    assert.deepEqual(body.data.projects[2], {
      id: "alpha",
      name: "Project alpha",
      root: "/Users/me/code/alpha",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    assert.ok(body.capabilities.includes("projects"));
  });
});

test("the registry's response-only migration marker never reaches a client", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({
        listProjects: async () => [
          { ...project("alpha", "2026-08-01T00:00:00.000Z"), legacyRoot: "~/code/alpha" },
        ],
      }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    const body = await response.json() as { data: { projects: Record<string, unknown>[] } };
    assert.equal("legacyRoot" in body.data.projects[0], false);
  });
});

test("a project touched mid-pagination is still served on the next page", async () => {
  // This is why the page key is createdAt and not updatedAt. alpha is the one
  // record still owed to the client after page one. Touching it moves it to
  // the FRONT of an updatedAt ordering — ahead of the cursor rather than
  // behind it — so an updatedAt keyset would skip it and the client would
  // never learn the project exists.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const authorization = `Bearer ${bearer}`;
    let registry = [...REGISTRY];
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({ listProjects: async () => registry }),
    );
    const first = await handler(request("?limit=2", { authorization }));
    const firstBody = await first.json() as {
      cursor: { next: string };
      data: { projects: { id: string }[] };
    };
    assert.deepEqual(firstBody.data.projects.map((row) => row.id), ["delta", "bravo"]);

    registry = registry.map((row) =>
      row.id === "alpha" ? { ...row, updatedAt: "2026-08-30T00:00:00.000Z" } : row);

    const second = await handler(
      request(`?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`, { authorization }),
    );
    const secondBody = await second.json() as { data: { projects: { id: string }[] } };
    assert.deepEqual(secondBody.data.projects.map((row) => row.id), ["alpha"]);
  });
});

test("an empty registry is an empty page, not a 404", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({ listProjects: async () => [] }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as { cursor?: unknown; data: { projects: unknown[] } };
    assert.deepEqual(body.data.projects, []);
    assert.equal("cursor" in body, false);
  });
});

test("an empty continuation page still echoes the cursor the client sent", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(runtime, sources());
    const exhausted = encodeClientV1Cursor({ sort: "1970-01-01T00:00:00.000Z", id: "zzzz" });
    const response = await handler(
      request(`?cursor=${encodeURIComponent(exhausted)}`, {
        authorization: `Bearer ${bearer}`,
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      cursor: { current: string; next?: string; hasMore: boolean };
      data: { projects: unknown[] };
    };
    assert.deepEqual(body.data.projects, []);
    assert.equal(body.cursor.hasMore, false);
    assert.equal(body.cursor.next, undefined);
    assert.equal(body.cursor.current, exhausted);
  });
});

test("the route refuses a query it does not serve instead of guessing a page", async () => {
  // Every other list route on this surface had this test and this one did not,
  // so the whole refusal path was unguarded HERE while the shared helper it
  // delegates to stayed green: replacing this route's `catch` with a silent
  // fallback to the default page survived the entire suite. A shared helper
  // being covered is not the same claim as this route calling it.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const query of [
      `?limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`,
      "?limit=0",
      "?limit=1e2",
      "?cursor=not%2Ba%2Bcursor",
      "?offset=10",
      "?limit=2&limit=3",
    ]) {
      const response = await handler(request(query, { authorization }));
      assert.equal(response.status, 400, query);
      const body = await response.json() as {
        error: { code: string; retryable: boolean; details?: { reason?: unknown } };
      };
      assert.equal(body.error.code, "invalid_request", query);
      assert.equal(body.error.retryable, false, query);
      // The reason is asserted as a VALUE, not merely as a defined field: a
      // route answering `details: {}` tells a client author nothing about
      // which parameter was wrong, and `notEqual(details, undefined)` would
      // pass for it.
      assert.equal(typeof body.error.details?.reason, "string", query);
      assert.ok((body.error.details!.reason as string).length > 0, query);
    }
    // The ceiling itself is served rather than refused — the refusals above
    // are a boundary, not a blanket.
    const atCeiling = await handler(
      request(`?limit=${CLIENT_V1_LIMITS.maxPageSize}`, { authorization }),
    );
    assert.equal(atCeiling.status, 200);
    const body = await atCeiling.json() as { data: { projects: { id: string }[] } };
    assert.deepEqual(body.data.projects.map((row) => row.id), ["delta", "bravo", "alpha"]);
  });
});

test("an unprojectable registry row answers an envelope, not a Next error page", async () => {
  // `loadProjects` returns whatever `projects.json` parsed to, so a
  // hand-edited row missing `createdAt` reaches the projection as `undefined`
  // and is refused there. Uncaught, that refusal escapes the handler and Next
  // answers with its own error body — not a Client v1 envelope, on a surface
  // whose whole contract is that every response is one.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({
        listProjects: async () => [
          ...REGISTRY,
          { id: "broken", name: "Broken", root: "/Users/me/code/broken" } as CaveProject,
        ],
      }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 500);
    const body = await response.json() as {
      apiVersion: string;
      error: { code: string; message: string; retryable: boolean; details?: unknown };
    };
    assert.equal(body.error.code, "internal_error");
    assert.equal(body.error.retryable, false);
    assert.equal(body.apiVersion, "1.0");
    assert.equal(body.error.details, undefined);
    // The refusal names no field of a stored record.
    assert.equal(body.error.message.includes("createdAt"), false);
  });
});

test("a registry read that throws answers an envelope too", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({
        listProjects: async () => {
          throw new Error("EACCES: permission denied, open '/home/me/.coven/cave/projects.json'");
        },
      }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 500);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "internal_error");
    // The path the store named must not reach the wire.
    assert.equal(body.error.message.includes("/home/me"), false);
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ProjectsGetHandler(runtime, sources());
    assert.equal((await handler(request())).status, 401);
    assert.equal(
      (await handler(request("", { authorization: "Bearer not-a-real-bearer" }))).status,
      401,
    );
    assert.equal(
      (await handler(request("", { authorization: `Bearer ${writeOnlyBearer}` }))).status,
      403,
    );
    const unstamped = new Request("http://127.0.0.1:3020/api/client/v1/projects", {
      headers: { authorization: `Bearer ${writeOnlyBearer}` },
    });
    assert.equal((await handler(unstamped)).status, 401);
  });
});

test("the registry is never read before the credential is checked", async () => {
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ProjectsGetHandler(
      runtime,
      sources({
        listProjects: async () => {
          reads += 1;
          return [];
        },
      }),
    );
    await handler(request());
    await handler(request("", { authorization: `Bearer ${writeOnlyBearer}` }));
    assert.equal(reads, 0);
  });
});

test("two identical concurrent bound bearer reads run one source read and encrypt one replay refusal", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 61 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-projects",
          scopes: ["chat:read"],
        });
        const originalFind =
          runtime.credentialStore.findByBearer.bind(runtime.credentialStore);
        let findCalls = 0;
        runtime.credentialStore.findByBearer = async (bearer) => {
          findCalls += 1;
          return originalFind(bearer);
        };
        const originalCharge =
          runtime.rateLimiter.consumeAuthenticated.bind(runtime.rateLimiter);
        let chargeCalls = 0;
        runtime.rateLimiter.consumeAuthenticated = (credentialId) => {
          chargeCalls += 1;
          return originalCharge(credentialId);
        };
        let sourceCalls = 0;
        const handler = createClientV1ProjectsGetHandler(
          runtime,
          sources({
            listProjects: async () => {
              sourceCalls += 1;
              return REGISTRY;
            },
          }),
        );

        const downgrade = await handler(
          request("?limit=1", {
            authorization: ["Bearer", issued.bearer].join(" "),
          }),
        );
        assert.equal(downgrade.status, 426);
        assert.deepEqual({ findCalls, chargeCalls, sourceCalls }, {
          findCalls: 0,
          chargeCalls: 0,
          sourceCalls: 0,
        });

        const prepared = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "projects.list",
          url: "http://127.0.0.1:3020/api/client/v1/projects?limit=1",
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(8),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const beforeQueryDrift = { findCalls, chargeCalls, sourceCalls };
        const wrongQuery = await handler(
          new Request(
            "http://127.0.0.1:3020/api/client/v1/projects?limit=2",
            { headers },
          ),
        );
        assert.equal(wrongQuery.status, 400);
        assert.deepEqual(
          { findCalls, chargeCalls, sourceCalls },
          beforeQueryDrift,
        );

        const boundRequest = new Request(prepared.request, { headers });
        const [leftResponse, rightResponse] = await Promise.all([
          handler(boundRequest.clone()),
          handler(boundRequest.clone()),
        ]);
        const opened = await Promise.all([
          openBoundJson(prepared, leftResponse),
          openBoundJson(prepared, rightResponse),
        ]);
        assert.deepEqual(
          opened.map(({ status }) => status).sort((left, right) => left - right),
          [200, 409],
        );
        assert.equal(
          opened.filter(({ status }) => status === 409).length,
          1,
        );
        assert.equal(
          ((opened.find(({ status }) => status === 409)!.body as {
            error: { details: { reason: string } };
          }).error.details.reason),
          "authority_replayed",
        );
        const success = opened.find(({ status }) => status === 200)!.body as {
          cursor: { next: string };
          data: { projects: { id: string }[] };
        };
        assert.deepEqual(success.data.projects.map(({ id }) => id), ["delta"]);
        assert.equal(findCalls, 1);
        assert.equal(chargeCalls, 1);
        assert.equal(sourceCalls, 1);

        const next = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "projects.list",
          url: `http://127.0.0.1:3020/api/client/v1/projects?limit=1&cursor=${encodeURIComponent(success.cursor.next)}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(9),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const nextHeaders = new Headers(next.request.headers);
        nextHeaders.set(LOCAL_PEER_HEADER, STAMP);
        const nextOpened = await openBoundJson(
          next,
          await handler(new Request(next.request, { headers: nextHeaders })),
        );
        assert.equal(nextOpened.status, 200);
        assert.deepEqual(
          (nextOpened.body as {
            data: { projects: { id: string }[] };
          }).data.projects.map(({ id }) => id),
          ["bravo"],
        );
        assert.equal(findCalls, 2);
        assert.equal(chargeCalls, 2);
        assert.equal(sourceCalls, 2);
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bound route diagnostics redact credentials, header names, and ciphertext across open, replay, and seal failures", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 62 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-diagnostics",
          scopes: ["chat:read"],
        });
        const pairing = runtime.pairingStore.create({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-diagnostics-pairing",
          scopes: ["chat:read"],
        });
        const handler = createClientV1ProjectsGetHandler(runtime, sources());
        const prepare = (nonce: number) =>
          createClientV1HpkeTestClient({
            authority: authority.authority,
            instanceId: INSTANCE_ID,
            runtimeNonce: authority.runtimeNonce,
            operation: "projects.list",
            url: "http://127.0.0.1:3020/api/client/v1/projects",
            method: "GET",
            issuedAt: BOUND_NOW,
            requestNonce: new Uint8Array(32).fill(nonce),
            authorization: { kind: "bearer", value: issued.bearer },
          });
        const logs: string[] = [];
        const originalWarn = console.warn;
        const originalError = console.error;
        console.warn = (...values: unknown[]) => {
          logs.push(values.map(String).join(" "));
        };
        console.error = (...values: unknown[]) => {
          logs.push(values.map(String).join(" "));
        };

        let requestCiphertext = "";
        let responseCiphertext = "";
        try {
          const malformed = await prepare(10);
          const malformedHeaders = new Headers(malformed.request.headers);
          malformedHeaders.set(LOCAL_PEER_HEADER, STAMP);
          requestCiphertext =
            malformedHeaders.get(CLIENT_V1_HPKE_HEADERS.ciphertext) ?? "";
          malformedHeaders.set(
            CLIENT_V1_HPKE_HEADERS.ciphertext,
            requestCiphertext.slice(0, -1),
          );
          assert.equal(
            (await handler(
              new Request(malformed.request, { headers: malformedHeaders }),
            )).status,
            400,
          );

          const wrongKey = await prepare(11);
          const wrongKeyHeaders = new Headers(wrongKey.request.headers);
          wrongKeyHeaders.set(LOCAL_PEER_HEADER, STAMP);
          wrongKeyHeaders.set(
            CLIENT_V1_HPKE_HEADERS.keyId,
            base64UrlEncode(new Uint8Array(32).fill(0xef)),
          );
          assert.equal(
            (await handler(
              new Request(wrongKey.request, { headers: wrongKeyHeaders }),
            )).status,
            409,
          );

          const replay = await prepare(12);
          const replayHeaders = new Headers(replay.request.headers);
          replayHeaders.set(LOCAL_PEER_HEADER, STAMP);
          const replayRequest = new Request(replay.request, {
            headers: replayHeaders,
          });
          const accepted = await handler(replayRequest.clone());
          const acceptedEnvelope = await accepted.clone().json() as {
            ciphertext: string;
          };
          responseCiphertext = acceptedEnvelope.ciphertext;
          assert.equal((await replay.open(accepted)).status, 200);
          const replayed = await replay.open(
            await handler(replayRequest.clone()),
          );
          assert.equal(replayed.status, 409);

          const oversizedHandler = createClientV1ProjectsGetHandler(
            runtime,
            sources({
              listProjects: async () => [{
                ...project("oversized", "2026-08-04T00:00:00.000Z"),
                name: "x".repeat(6_300_000),
              }],
            }),
          );
          const sealFailure = await prepare(13);
          const sealHeaders = new Headers(sealFailure.request.headers);
          sealHeaders.set(LOCAL_PEER_HEADER, STAMP);
          const failedSeal = await oversizedHandler(
            new Request(sealFailure.request, { headers: sealHeaders }),
          );
          assert.equal(failedSeal.status, 500);

          const replacementSuite = createClientV1HpkeSuite();
          const replacement = await replacementSuite.kem.deriveKeyPair(
            new Uint8Array(32).fill(0xf0),
          );
          const responsePublicKey =
            await replacementSuite.kem.deserializePublicKey(
              replay.responsePublicKey,
            );
          const sender = await replacementSuite.createSenderContext({
            recipientPublicKey: responsePublicKey,
            senderKey: replacement.privateKey,
            info: CLIENT_V1_HPKE_RESPONSE_INFO,
          });
          const plaintext = canonicalize({
            body: base64UrlEncode(
              new TextEncoder().encode('{"apiVersion":"1.0","data":{}}'),
            ),
            headers: { contentType: "application/json" },
            requestNonce: replay.binding.requestNonce,
            status: 200,
            version: 1,
          });
          assert.equal(typeof plaintext, "string");
          const forgedCiphertext = await sender.seal(
            new TextEncoder().encode(plaintext as string),
            replay.responseAad,
          );
          const forged = Response.json(
            {
              version: 1,
              mechanism: CLIENT_V1_HPKE_MECHANISM,
              keyId: replay.binding.keyId,
              requestNonce: replay.binding.requestNonce,
              enc: base64UrlEncode(sender.enc),
              ciphertext: base64UrlEncode(new Uint8Array(forgedCiphertext)),
            },
            {
              headers: {
                "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
              },
            },
          );
          await assert.rejects(
            replay.open(forged),
            /authenticated HPKE response/u,
          );
        } finally {
          console.warn = originalWarn;
          console.error = originalError;
        }

        const renderedLogs = logs.join("\n");
        for (const secret of [
          pairing.secret,
          issued.bearer,
          "authorization",
          "x-coven-pairing-secret",
          requestCiphertext,
          responseCiphertext,
        ]) {
          assert.equal(renderedLogs.includes(secret), false, secret);
        }
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
