import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ConversationSummary } from "@/lib/cave-conversations.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { decodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ConversationsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-conversations-");
const STAMP = "loopback-secret";

function summary(sessionId: string, updatedAt: string): ConversationSummary {
  return { sessionId, familiarId: "scribe", harness: "claude", updatedAt };
}

const LEDGER: ConversationSummary[] = [
  summary("conversation-a", "2026-08-01T00:00:00.000Z"),
  summary("conversation-b", "2026-08-05T00:00:00.000Z"),
  summary("conversation-c", "2026-08-05T00:00:00.000Z"),
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

function request(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3020/api/client/v1/conversations${query}`, {
    headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers },
  });
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

test("conversations are served most-recently-updated first, id breaking the tie", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationsGetHandler(runtime, sources());
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      capabilities: string[];
      data: { conversations: Record<string, unknown>[] };
    };
    assert.deepEqual(
      body.data.conversations.map((row) => row.id),
      ["conversation-c", "conversation-b", "conversation-a"],
    );
    assert.deepEqual(body.data.conversations[0], {
      id: "conversation-c",
      familiarId: "scribe",
      harness: "claude",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.ok(body.capabilities.includes("conversations"));
    assert.ok(body.capabilities.includes("cursors"));
  });
});

test("the ledger pages through a cursor without repeating a tied conversation", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    const first = await handler(request("?limit=2", { authorization }));
    const firstBody = await first.json() as {
      cursor: { next: string; hasMore: boolean };
      data: { conversations: { id: string }[] };
    };
    assert.deepEqual(
      firstBody.data.conversations.map((row) => row.id),
      ["conversation-c", "conversation-b"],
    );
    // conversation-b and conversation-c share an updatedAt, so the cursor must
    // carry the id as well or the second page starts at conversation-c again.
    assert.deepEqual(decodeClientV1Cursor(firstBody.cursor.next), {
      sort: "2026-08-05T00:00:00.000Z",
      id: "conversation-b",
    });

    const second = await handler(
      request(`?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`, { authorization }),
    );
    const secondBody = await second.json() as {
      cursor: { hasMore: boolean; next?: string };
      data: { conversations: { id: string }[] };
    };
    assert.deepEqual(secondBody.data.conversations.map((row) => row.id), ["conversation-a"]);
    assert.equal(secondBody.cursor.hasMore, false);
    assert.equal(secondBody.cursor.next, undefined);
  });
});

test("the page ceiling is the contract's, not the caller's", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const many = Array.from({ length: CLIENT_V1_LIMITS.maxPageSize + 10 }, (_, index) =>
      summary(`conversation-${String(index).padStart(4, "0")}`, "2026-08-05T00:00:00.000Z"));
    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({ listConversations: async () => many }),
    );
    const authorization = `Bearer ${bearer}`;
    const capped = await handler(
      request(`?limit=${CLIENT_V1_LIMITS.maxPageSize}`, { authorization }),
    );
    const cappedBody = await capped.json() as {
      cursor: { hasMore: boolean };
      data: { conversations: unknown[] };
    };
    assert.equal(cappedBody.data.conversations.length, CLIENT_V1_LIMITS.maxPageSize);
    assert.equal(cappedBody.cursor.hasMore, true);

    // One over the ceiling is refused rather than quietly clamped: a client
    // that asked for 101 and received 100 cannot tell whether it reached the
    // ceiling or the end of the ledger.
    const refused = await handler(
      request(`?limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`, { authorization }),
    );
    assert.equal(refused.status, 400);
  });
});

test("an empty ledger is an empty page with no cursor", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({ listConversations: async () => [] }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as { cursor?: unknown; data: { conversations: unknown[] } };
    assert.deepEqual(body.data.conversations, []);
    assert.equal("cursor" in body, false);
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationsGetHandler(runtime, sources());
    assert.equal((await handler(request())).status, 401);
    assert.equal(
      (await handler(request("", { authorization: "Bearer not-a-real-bearer" }))).status,
      401,
    );
    assert.equal(
      (await handler(request("", { authorization: `Bearer ${writeOnlyBearer}` }))).status,
      403,
    );
    const unstamped = new Request("http://127.0.0.1:3020/api/client/v1/conversations", {
      headers: { authorization: `Bearer ${writeOnlyBearer}` },
    });
    assert.equal((await handler(unstamped)).status, 401);
  });
});

test("no transcript is read before the credential is checked", async () => {
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({
        listConversations: async () => {
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

test("an unprojectable ledger row answers an envelope, not a Next error page", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    // A conversation file that PARSES but carries no `updatedAt` does not take
    // listConversations' fallback row — that substitution is keyed on a parse
    // failure — so the field reaches the projection as `undefined`. It used to
    // throw out of the handler, and Next answered with its own error body:
    // not a Client v1 envelope, on a surface whose whole contract is that every
    // response is one. One bad row took down every page containing it.
    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({
        listConversations: async () => [
          ...LEDGER,
          { sessionId: "conversation-broken", familiarId: "scribe" } as ConversationSummary,
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
    // Not retryable: the store answers the same way next second, so a retry
    // spends the caller's budget to be told the same thing.
    assert.equal(body.error.retryable, false);
    // The envelope is intact — a client that only knows how to parse this shape
    // can still read its own failure.
    assert.equal(body.apiVersion, "1.0");
    // And the refusal names no field of a stored record: details on an error
    // the caller cannot fix is a description of the server's disk.
    assert.equal(body.error.details, undefined);
    assert.equal(body.error.message.includes("updatedAt"), false);
  });
});

test("a store that throws answers an envelope too", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    // listConversations swallows a readdir failure, but ensureDir above it does
    // not, and neither does loadConfig on the roster route. The guard covers
    // the read as well as the projection over it.
    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({
        listConversations: async () => {
          throw new Error("EACCES: permission denied, scandir '/home/me/.coven/cave/conversations'");
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
