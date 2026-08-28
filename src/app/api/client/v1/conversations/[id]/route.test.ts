import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ConversationSummary } from "@/lib/cave-conversations.ts";
import {
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ConversationGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-conversation-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-conversation-route-test";
const BOUND_NOW = 50_000;

const LEDGER: ConversationSummary[] = [
  {
    sessionId: "conversation-1",
    familiarId: "scribe",
    harness: "claude",
    title: "Ledger cleanup",
    status: "completed",
    exitCode: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  },
  {
    sessionId: "conversation-2",
    familiarId: "mote",
    updatedAt: "2026-08-06T00:00:00.000Z",
  },
];

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: unsupported,
    listProjects: unsupported,
    listConversations: async () => LEDGER,
    loadConversation: unsupported,
    ...overrides,
  };
}

function request(id: string, headers: Record<string, string> = {}, query = ""): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/conversations/${encodeURIComponent(id)}${query}`,
    { headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers } },
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
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

test("one conversation reads exactly as its row in the ledger", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationGetHandler(runtime, sources());
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { conversation: Record<string, unknown> } };
    // Byte-identical to what the list route serves for the same id. The detail
    // read is deliberately the same projection over the same source: deriving
    // it from loadConversation instead would have dropped `status` and
    // `exitCode`, which the ledger computes and a raw transcript file does not
    // carry — so the same conversation would have reported two different
    // shapes depending on which route a client asked.
    assert.deepEqual(body.data.conversation, {
      id: "conversation-1",
      familiarId: "scribe",
      harness: "claude",
      title: "Ledger cleanup",
      status: "completed",
      exitCode: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
  });
});

test("an id no conversation carries is not_found, whatever shape it has", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const id of [
      "conversation-9",
      // A traversal attempt that survived URL decoding, which is reachable
      // because a percent-encoded segment escapes the client-v1 ingress
      // classification entirely (#4854).
      "../../../etc/passwd",
      "..",
      "",
      "conversation-1/messages",
      // Prefix and suffix near-misses: the id is matched whole, never by
      // startsWith, so neither can reach a real conversation.
      "conversation-",
      "conversation-10",
    ]) {
      const response = await handler(
        request(id, { authorization }),
        context(id),
      );
      assert.equal(response.status, 404, id);
      const body = await response.json() as { error: { code: string; retryable: boolean } };
      assert.equal(body.error.code, "not_found", id);
      assert.equal(body.error.retryable, false, id);
    }
  });
});

test("an unprojectable ledger row answers an envelope, not a Next error page", async () => {
  // The list route had this test and the detail route did not, so removing
  // this route's guard left the whole suite green. A transcript that PARSES
  // but carries no `updatedAt` does not take listConversations' fallback row —
  // that substitution is keyed on a parse failure — so the field reaches the
  // projection as `undefined` and is refused there. Uncaught, Next answers
  // with its own error body on a surface whose contract is that every response
  // is an envelope.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationGetHandler(
      runtime,
      sources({
        listConversations: async () => [
          { sessionId: "conversation-broken", familiarId: "scribe" } as ConversationSummary,
        ],
      }),
    );
    const response = await handler(
      request("conversation-broken", { authorization: `Bearer ${bearer}` }),
      context("conversation-broken"),
    );
    assert.equal(response.status, 500);
    const body = await response.json() as {
      apiVersion: string;
      error: { code: string; message: string; retryable: boolean; details?: unknown };
    };
    assert.equal(body.error.code, "internal_error");
    // Not `not_found`: the row exists and the client asked for it by its real
    // id. Answering `not_found` would tell a client the conversation is gone.
    assert.equal(body.error.retryable, false);
    assert.equal(body.apiVersion, "1.0");
    assert.equal(body.error.details, undefined);
    assert.equal(body.error.message.includes("updatedAt"), false);
  });
});

test("a ledger read that throws answers an envelope too", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationGetHandler(
      runtime,
      sources({
        listConversations: async () => {
          throw new Error("EACCES: permission denied, scandir '/home/me/.coven/cave/conversations'");
        },
      }),
    );
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    assert.equal(response.status, 500);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "internal_error");
    // The path the store named must not reach the wire.
    assert.equal(body.error.message.includes("/home/me"), false);
  });
});

test("the detail route serves no page parameters at all", async () => {
  // A single record has nothing to page, so `limit` and `cursor` are as
  // meaningless here as `offset` — and answering a request that carries one as
  // though it did not is how a client learns to send them everywhere.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const query of ["?limit=5", "?cursor=abc", "?offset=1"]) {
      const response = await handler(
        request("conversation-1", { authorization }, query),
        context("conversation-1"),
      );
      assert.equal(response.status, 400, query);
      assert.equal(
        (await response.json() as { error: { code: string } }).error.code,
        "invalid_request",
        query,
      );
    }
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationGetHandler(runtime, sources());
    assert.equal(
      (await handler(request("conversation-1"), context("conversation-1"))).status,
      401,
    );
    assert.equal(
      (await handler(
        request("conversation-1", { authorization: "Bearer not-a-real-bearer" }),
        context("conversation-1"),
      )).status,
      401,
    );
    assert.equal(
      (await handler(
        request("conversation-1", { authorization: `Bearer ${writeOnlyBearer}` }),
        context("conversation-1"),
      )).status,
      403,
    );
    const unstamped = new Request(
      "http://127.0.0.1:3020/api/client/v1/conversations/conversation-1",
      { headers: { authorization: `Bearer ${writeOnlyBearer}` } },
    );
    assert.equal((await handler(unstamped, context("conversation-1"))).status, 401);
  });
});

test("an unauthenticated probe cannot learn whether a conversation exists", async () => {
  // The ledger is not read at all until the credential is settled, so a
  // refused caller sees the same answer for a real id and an invented one —
  // and cannot use the route to enumerate conversation ids.
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationGetHandler(
      runtime,
      sources({
        listConversations: async () => {
          reads += 1;
          return LEDGER;
        },
      }),
    );
    const real = await handler(request("conversation-1"), context("conversation-1"));
    const invented = await handler(request("conversation-9"), context("conversation-9"));
    assert.equal(real.status, invented.status);
    assert.deepEqual(await real.json(), await invented.json());
    await handler(
      request("conversation-1", { authorization: `Bearer ${writeOnlyBearer}` }),
      context("conversation-1"),
    );
    assert.equal(reads, 0);
  });
});

test("bound conversation detail preserves encoded query punctuation, spaces, and Unicode", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 81 },
      async (authority) => {
        const conversationId = "conversation one?# with snow 雪";
        const encodedPath =
          `/api/client/v1/conversations/${encodeURIComponent(conversationId)}`;
        const boundLedger: ConversationSummary[] = [
          ...LEDGER,
          {
            sessionId: conversationId,
            familiarId: "scribe",
            createdAt: "2026-08-07T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
          },
        ];
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-conversation",
          scopes: ["chat:read"],
        });
        const originalFind =
          runtime.credentialStore.findByBearer.bind(runtime.credentialStore);
        const originalCharge =
          runtime.rateLimiter.consumeAuthenticated.bind(runtime.rateLimiter);
        let findCalls = 0;
        let chargeCalls = 0;
        let sourceCalls = 0;
        runtime.credentialStore.findByBearer = async (bearer) => {
          findCalls += 1;
          return originalFind(bearer);
        };
        runtime.rateLimiter.consumeAuthenticated = (credentialId) => {
          chargeCalls += 1;
          return originalCharge(credentialId);
        };
        const handler = createClientV1ConversationGetHandler(
          runtime,
          sources({
            listConversations: async () => {
              sourceCalls += 1;
              return boundLedger;
            },
          }),
        );

        const downgrade = await handler(
          request(
            conversationId,
            { authorization: ["Bearer", issued.bearer].join(" ") },
          ),
          context(conversationId),
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
          operation: "conversations.read",
          url: `http://127.0.0.1:3020${encodedPath}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(15),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const valid = await handler(
          new Request(prepared.request, { headers }),
          context(conversationId),
        );
        assert.equal(valid.status, 200);
        assert.equal(
          valid.headers.get("content-type"),
          CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
        );
        const opened = await prepared.open(valid);
        assert.equal(opened.status, 200);
        assert.equal(
          (JSON.parse(new TextDecoder().decode(opened.body)) as {
            data: { conversation: { id: string } };
          }).data.conversation.id,
          conversationId,
        );
        assert.equal(new URL(prepared.request.url).pathname, encodedPath);
        assert.deepEqual({ findCalls, chargeCalls, sourceCalls }, {
          findCalls: 1,
          chargeCalls: 1,
          sourceCalls: 1,
        });

        const beforeQueryDrift = { findCalls, chargeCalls, sourceCalls };
        const wrongQuery = await handler(
          new Request(
            `http://127.0.0.1:3020${encodedPath}?limit=1`,
            { headers },
          ),
          context(conversationId),
        );
        assert.equal(wrongQuery.status, 400);
        assert.deepEqual(
          { findCalls, chargeCalls, sourceCalls },
          beforeQueryDrift,
        );
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
