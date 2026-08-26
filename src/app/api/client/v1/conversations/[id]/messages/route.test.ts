import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ChatTurn, ConversationFile } from "@/lib/cave-conversations.ts";
import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { encodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ConversationMessagesGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-messages-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-messages-route-test";
const BOUND_NOW = 55_000;

function turn(
  id: string,
  parentId: string | null,
  at: string,
  role: ChatTurn["role"] = "user",
): ChatTurn {
  return { id, parentId, role, text: `text-${id}`, createdAt: at };
}

/**
 * A branched transcript. t2 is an abandoned reply to t1; the live branch is
 * t1 → t3 → t4, and both replies were persisted with their prompt's stamp.
 */
const BRANCHED: ConversationFile = {
  sessionId: "conversation-1",
  familiarId: "scribe",
  harness: "claude",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:02:00.000Z",
  activeLeafId: "t4",
  turns: [
    turn("t1", null, "2026-08-01T00:00:00.000Z"),
    turn("t2", "t1", "2026-08-01T00:00:00.000Z", "assistant"),
    turn("t3", "t1", "2026-08-01T00:00:00.000Z", "assistant"),
    turn("t4", "t3", "2026-08-01T00:02:00.000Z"),
  ],
};

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: unsupported,
    listProjects: unsupported,
    listConversations: unsupported,
    loadConversation: async (id) => (id === "conversation-1" ? BRANCHED : null),
    ...overrides,
  };
}

function request(id: string, headers: Record<string, string> = {}, query = ""): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/conversations/${encodeURIComponent(id)}/messages${query}`,
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

test("messages are the live branch in chronological order, not the stored array", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      capabilities: string[];
      data: { messages: Record<string, unknown>[] };
    };
    // t2 is on the branch the user walked away from; serving the raw turns
    // array would interleave it into the transcript.
    assert.deepEqual(body.data.messages.map((message) => message.id), ["t1", "t3", "t4"]);
    assert.deepEqual(body.data.messages[1], {
      id: "t3",
      conversationId: "conversation-1",
      parentId: "t1",
      role: "assistant",
      text: "text-t3",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachmentCount: 0,
      toolCount: 0,
    });
    assert.ok(body.capabilities.includes("conversation-messages"));
  });
});

test("paging a transcript resumes by position, so a shared stamp cannot reorder it", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    // t1 and t3 carry the SAME createdAt. A keyset over (createdAt, id) would
    // have to break the tie on the id, which puts the reply before the prompt
    // it answers.
    const first = await handler(
      request("conversation-1", { authorization }, "?limit=2"),
      context("conversation-1"),
    );
    const firstBody = await first.json() as {
      cursor: { next: string; hasMore: boolean };
      data: { messages: { id: string }[] };
    };
    assert.deepEqual(firstBody.data.messages.map((message) => message.id), ["t1", "t3"]);
    assert.equal(firstBody.cursor.hasMore, true);

    const second = await handler(
      request(
        "conversation-1",
        { authorization },
        `?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`,
      ),
      context("conversation-1"),
    );
    const secondBody = await second.json() as {
      cursor: { current: string; next?: string; hasMore: boolean };
      data: { messages: { id: string }[] };
    };
    assert.deepEqual(secondBody.data.messages.map((message) => message.id), ["t4"]);
    assert.equal(secondBody.cursor.hasMore, false);
    assert.equal(secondBody.cursor.next, undefined);

    // Replaying the same cursor returns the same page rather than advancing.
    const replay = await handler(
      request(
        "conversation-1",
        { authorization },
        `?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`,
      ),
      context("conversation-1"),
    );
    assert.deepEqual(await replay.json(), secondBody);
  });
});

test("a cursor whose turn left the active branch is reconcile_required", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
    // t2 is a real turn in the file and is NOT on the branch being served, so
    // this is precisely the state a client reaches by paging while someone
    // switches branches in the desktop. Restarting at the top would silently
    // replay the conversation; resuming at position zero would serve a
    // different branch under the same token.
    const stale = encodeClientV1Cursor({ sort: "2026-08-01T00:00:00.000Z", id: "t2" });
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }, `?cursor=${encodeURIComponent(stale)}`),
      context("conversation-1"),
    );
    assert.equal(response.status, 409);
    const body = await response.json() as {
      error: { code: string; retryable: boolean; details: { reason: string } };
    };
    assert.equal(body.error.code, "reconcile_required");
    assert.equal(body.error.details.reason, "resume_from_canonical_state");
    // Not retryable: the same cursor will be refused the same way until the
    // client restarts the read.
    assert.equal(body.error.retryable, false);
  });
});

test("an empty transcript is an empty page with no cursor", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async () => ({ ...BRANCHED, activeLeafId: undefined, turns: [] }),
      }),
    );
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { cursor?: unknown; data: { messages: unknown[] } };
    assert.deepEqual(body.data.messages, []);
    assert.equal("cursor" in body, false);
  });
});

test("the route refuses a query it does not serve instead of guessing a page", async () => {
  // This route had no refusal test of its own, so replacing its `catch` with a
  // silent fallback to the default page survived the whole suite — the shared
  // helper's unit coverage says the helper refuses, not that this route calls
  // it. The ceiling matters most here: a transcript is the one canonical read
  // whose page cost scales with how much was said.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const query of [
      `?limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`,
      "?limit=0",
      "?limit=1e2",
      "?cursor=not%2Ba%2Bcursor",
      "?offset=10",
      "?limit=2&limit=3",
    ]) {
      const response = await handler(
        request("conversation-1", { authorization }, query),
        context("conversation-1"),
      );
      assert.equal(response.status, 400, query);
      const body = await response.json() as {
        error: { code: string; retryable: boolean; details?: { reason?: unknown } };
      };
      assert.equal(body.error.code, "invalid_request", query);
      assert.equal(body.error.retryable, false, query);
      assert.equal(typeof body.error.details?.reason, "string", query);
    }
    // The ceiling itself is served, and the transcript is shorter than it, so
    // the whole active branch comes back on one page.
    const atCeiling = await handler(
      request("conversation-1", { authorization }, `?limit=${CLIENT_V1_LIMITS.maxPageSize}`),
      context("conversation-1"),
    );
    assert.equal(atCeiling.status, 200);
    const body = await atCeiling.json() as { data: { messages: { id: string }[] } };
    assert.deepEqual(body.data.messages.map((row) => row.id), ["t1", "t3", "t4"]);
  });
});

test("a query is refused before the transcript is read", async () => {
  // The refusal above must not be reachable only after the file has been
  // opened: a malformed `limit` is a client bug, and answering it should cost
  // no disk read at all.
  let reads = 0;
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async () => {
          reads += 1;
          return BRANCHED;
        },
      }),
    );
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }, "?offset=10"),
      context("conversation-1"),
    );
    assert.equal(response.status, 400);
    assert.equal(reads, 0);
  });
});

test("an unreadable or absent transcript is not_found, never a 500", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    // loadConversation resolves the id through a traversal guard and returns
    // null for anything it refuses, so a `..` segment that survived URL
    // decoding (#4854) reads as absent rather than reaching the filesystem.
    for (const id of ["conversation-9", "../../../etc/passwd", ".."]) {
      const response = await handler(request(id, { authorization }), context(id));
      assert.equal(response.status, 404, id);
      assert.equal(
        (await response.json() as { error: { code: string } }).error.code,
        "not_found",
        id,
      );
    }
  });
});

test("the transcript's harness internals never reach the wire", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async () => ({
          ...BRANCHED,
          activeLeafId: "t1",
          turns: [
            {
              ...turn("t1", null, "2026-08-01T00:00:00.000Z", "assistant"),
              reasoning: "private-scratchpad",
              tools: [{
                id: "tool-1",
                name: "bash",
                input: "cat ~/.ssh/id_rsa",
                output: "PRIVATE-KEY-MATERIAL",
                status: "ok",
              }],
              costUsd: 0.02,
            },
          ],
        }),
      }),
    );
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    const raw = await response.text();
    for (const leaked of ["private-scratchpad", "PRIVATE-KEY-MATERIAL", "id_rsa", "costUsd"]) {
      assert.equal(raw.includes(leaked), false, leaked);
    }
    const body = JSON.parse(raw) as { data: { messages: { toolCount: number }[] } };
    // The fact that the turn ran a tool is still reported; what the tool
    // touched is not.
    assert.equal(body.data.messages[0].toolCount, 1);
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(runtime, sources());
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
      "http://127.0.0.1:3020/api/client/v1/conversations/conversation-1/messages",
      { headers: { authorization: `Bearer ${writeOnlyBearer}` } },
    );
    assert.equal((await handler(unstamped, context("conversation-1"))).status, 401);
  });
});

test("no transcript is opened before the credential is checked", async () => {
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async () => {
          reads += 1;
          return BRANCHED;
        },
      }),
    );
    await handler(request("conversation-1"), context("conversation-1"));
    await handler(
      request("conversation-1", { authorization: `Bearer ${writeOnlyBearer}` }),
      context("conversation-1"),
    );
    assert.equal(reads, 0);
  });
});

test("conversationId is the transcript's own id, never the spelling in the URL", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    // A conversation resolves to a FILE, and both filesystems this ships on are
    // case-insensitive, so `/conversations/CONVERSATION-1/messages` reads
    // conversation-1.json and answers 200. Echoing the requested spelling
    // handed the client a `conversationId` that `GET /conversations/<that>`
    // then answers `not_found` for, because the ledger route matches sessionId
    // exactly — two canonical reads disagreeing about one conversation's id.
    //
    // The fixture is the seam, not the filesystem: loadConversation is the
    // thing that resolves loosely, so the source below stands in for it.
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async (id) =>
          (id.toLowerCase() === "conversation-1" ? BRANCHED : null),
      }),
    );
    const response = await handler(
      request("CONVERSATION-1", { authorization: `Bearer ${bearer}` }),
      context("CONVERSATION-1"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { messages: { conversationId: string }[] } };
    assert.ok(body.data.messages.length > 0);
    for (const message of body.data.messages) {
      assert.equal(message.conversationId, "conversation-1");
    }
  });
});

test("an unprojectable turn answers an envelope, not a Next error page", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    // loadConversation validates nothing beyond "this parsed", so a transcript
    // whose turn carries no text reached the envelope builder as `undefined`
    // and threw out of the handler. Next answered with its own body, which no
    // Client v1 client can parse.
    const handler = createClientV1ConversationMessagesGetHandler(
      runtime,
      sources({
        loadConversation: async () => ({
          ...BRANCHED,
          activeLeafId: "t9",
          turns: [{ id: "t9", parentId: null, role: "user" } as ChatTurn],
        }),
      }),
    );
    const response = await handler(
      request("conversation-1", { authorization: `Bearer ${bearer}` }),
      context("conversation-1"),
    );
    assert.equal(response.status, 500);
    const body = await response.json() as {
      apiVersion: string;
      error: { code: string; retryable: boolean };
    };
    assert.equal(body.error.code, "internal_error");
    assert.equal(body.error.retryable, false);
    assert.equal(body.apiVersion, "1.0");
  });
});

test("bound messages encrypt results and reject downgrade or AAD drift before stores, budgets, and sources", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 91 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-messages",
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
        const handler = createClientV1ConversationMessagesGetHandler(
          runtime,
          sources({
            loadConversation: async (id) => {
              sourceCalls += 1;
              return id === "conversation-1" ? BRANCHED : null;
            },
          }),
        );

        const downgrade = await handler(
          request(
            "conversation-1",
            { authorization: ["Bearer", issued.bearer].join(" ") },
          ),
          context("conversation-1"),
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
          operation: "messages.list",
          url: "http://127.0.0.1:3020/api/client/v1/conversations/conversation-1/messages",
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(16),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const valid = await handler(
          new Request(prepared.request, { headers }),
          context("conversation-1"),
        );
        assert.equal(valid.status, 200);
        assert.equal(
          valid.headers.get("content-type"),
          CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
        );
        const opened = await prepared.open(valid);
        assert.equal(opened.status, 200);
        assert.deepEqual(
          (JSON.parse(new TextDecoder().decode(opened.body)) as {
            data: { messages: { id: string }[] };
          }).data.messages.map(({ id }) => id),
          ["t1", "t3", "t4"],
        );
        assert.deepEqual({ findCalls, chargeCalls, sourceCalls }, {
          findCalls: 1,
          chargeCalls: 1,
          sourceCalls: 1,
        });

        const aadHeaders = new Headers(headers);
        aadHeaders.set(
          CLIENT_V1_HPKE_HEADERS.issuedAt,
          String(BOUND_NOW + 1),
        );
        const beforeAadDrift = { findCalls, chargeCalls, sourceCalls };
        const wrongAad = await handler(
          new Request(prepared.request, { headers: aadHeaders }),
          context("conversation-1"),
        );
        assert.equal(wrongAad.status, 400);
        assert.deepEqual(
          { findCalls, chargeCalls, sourceCalls },
          beforeAadDrift,
        );
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
