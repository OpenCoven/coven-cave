import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ConversationSummary } from "@/lib/cave-conversations.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ConversationGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-conversation-");
const STAMP = "loopback-secret";

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
