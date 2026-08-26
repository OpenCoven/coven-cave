import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ConversationSummary } from "@/lib/cave-conversations.ts";
import {
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { decodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ConversationsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-conversations-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-conversations-route-test";
const BOUND_NOW = 45_000;

function summary(sessionId: string, createdAt: string, updatedAt = createdAt): ConversationSummary {
  return { sessionId, familiarId: "scribe", harness: "claude", createdAt, updatedAt };
}

/**
 * Three rows whose `createdAt` and `updatedAt` orderings DISAGREE.
 *
 * `createdAt` descending is [b, a, c]; `updatedAt` descending is [c, b, a]. A
 * route that reverted to the mutable key would serve a perfectly plausible
 * order, so a fixture where the two agree cannot see the regression this file
 * exists to pin (cave-fhjlu). `a` and `b` also share a `createdAt`, so the id
 * tiebreak is exercised rather than merely present.
 */
const LEDGER: ConversationSummary[] = [
  summary("conversation-a", "2026-08-05T00:00:00.000Z", "2026-08-01T00:00:00.000Z"),
  summary("conversation-b", "2026-08-05T00:00:00.000Z", "2026-08-05T00:00:00.000Z"),
  summary("conversation-c", "2026-08-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z"),
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

test("conversations are served most-recently-created first, id breaking the tie", async () => {
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
      ["conversation-b", "conversation-a", "conversation-c"],
    );
    // NOT the updatedAt-descending order, which is the whole point: that key
    // moves under an open cursor and skipped rows off the bottom of a walk.
    assert.notDeepEqual(
      body.data.conversations.map((row) => row.id),
      ["conversation-c", "conversation-b", "conversation-a"],
    );
    assert.deepEqual(body.data.conversations[0], {
      id: "conversation-b",
      familiarId: "scribe",
      harness: "claude",
      createdAt: "2026-08-05T00:00:00.000Z",
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
      ["conversation-b", "conversation-a"],
    );
    // conversation-a and conversation-b share a createdAt, so the cursor must
    // carry the id as well or the second page starts at conversation-b again.
    assert.deepEqual(decodeClientV1Cursor(firstBody.cursor.next), {
      sort: "2026-08-05T00:00:00.000Z",
      id: "conversation-a",
    });

    const second = await handler(
      request(`?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`, { authorization }),
    );
    const secondBody = await second.json() as {
      cursor: { hasMore: boolean; next?: string };
      data: { conversations: { id: string }[] };
    };
    assert.deepEqual(secondBody.data.conversations.map((row) => row.id), ["conversation-c"]);
    assert.equal(secondBody.cursor.hasMore, false);
    assert.equal(secondBody.cursor.next, undefined);
  });
});

// ── a ledger that moves while the client is paging (cave-fhjlu) ──────────────
//
// The route used to key on `updatedAt`. That field only ever rises and the
// ordering is descending, so a conversation touched mid-walk jumped ABOVE the
// open cursor and, if the walk had not reached it yet, was never served: silent
// data loss in a canonical read, and not the deduplicable repeat the reference
// claimed. Every case below walks to EXHAUSTION rather than checking the page
// after the mutation — a row that comes back three pages later is a repeat, a
// row that never comes back is a skip, and one page cannot tell them apart.

/** conversation-06 down to conversation-01, createdAt descending. */
function ledgerOfSix(): ConversationSummary[] {
  return Array.from({ length: 6 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return summary(
      `conversation-${n}`,
      `2026-03-${n}T00:00:00.000Z`,
      // updatedAt runs the other way, so an updatedAt-keyed walk serves a
      // visibly different sequence rather than accidentally the same one.
      `2026-04-${String(6 - index).padStart(2, "0")}T00:00:00.000Z`,
    );
  });
}

const SIX_IN_ORDER = [
  "conversation-06",
  "conversation-05",
  "conversation-04",
  "conversation-03",
  "conversation-02",
  "conversation-01",
];

/**
 * Walk the ledger at limit 2, apply `mutate` with the first cursor OPEN, then
 * follow that cursor to exhaustion. Returns every id the walk served, in order.
 */
async function walkAcrossMutation(
  runtime: ClientV1Runtime,
  bearer: string,
  ledger: { rows: ConversationSummary[] },
  mutate: (served: string[], cursorNames: string) => void,
): Promise<{ served: string[]; statuses: number[] }> {
  const handler = createClientV1ConversationsGetHandler(
    runtime,
    sources({ listConversations: async () => ledger.rows }),
  );
  const authorization = `Bearer ${bearer}`;
  const page = async (query: string) => {
    const response = await handler(request(query, { authorization }));
    const body = await response.json() as {
      cursor?: { next?: string };
      data?: { conversations?: { id: string }[] };
    };
    return {
      status: response.status,
      ids: (body.data?.conversations ?? []).map((row) => row.id),
      next: body.cursor?.next,
    };
  };

  const first = await page("?limit=2");
  const statuses = [first.status];
  const served = [...first.ids];
  mutate(first.ids, first.ids[first.ids.length - 1]);

  let token = first.next;
  for (let index = 0; index < 20 && token; index += 1) {
    const next = await page(`?limit=2&cursor=${encodeURIComponent(token)}`);
    statuses.push(next.status);
    if (next.status !== 200) break;
    served.push(...next.ids);
    token = next.next;
  }
  return { served, statuses };
}

test("a conversation touched mid-walk is still served by the rest of the walk", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const ledger = { rows: ledgerOfSix() };
    // conversation-01 is LAST in the ordering, so the first page has not reached
    // it. Under the old key this touch moved it above the open cursor and the
    // walk never served it again — measured, not hypothesised.
    const walk = await walkAcrossMutation(runtime, bearer, ledger, () => {
      ledger.rows = ledger.rows.map((row) =>
        row.sessionId === "conversation-01"
          ? { ...row, updatedAt: "2026-12-31T00:00:00.000Z" }
          : row);
    });
    assert.deepEqual(walk.statuses, [200, 200, 200]);
    assert.deepEqual(walk.served, SIX_IN_ORDER);
  });
});

test("touching a conversation the walk has already served does not repeat it", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const ledger = { rows: ledgerOfSix() };
    const walk = await walkAcrossMutation(runtime, bearer, ledger, (served) => {
      ledger.rows = ledger.rows.map((row) =>
        row.sessionId === served[0] ? { ...row, updatedAt: "2026-12-31T00:00:00.000Z" } : row);
    });
    assert.deepEqual(walk.served, SIX_IN_ORDER);
    assert.equal(new Set(walk.served).size, walk.served.length);
  });
});

test("touching the row the open cursor names leaves the cursor's position intact", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const ledger = { rows: ledgerOfSix() };
    // The token carries this row's sort key. A key that can move leaves the
    // cursor naming a position the ordering no longer has.
    const walk = await walkAcrossMutation(runtime, bearer, ledger, (_served, cursorNames) => {
      ledger.rows = ledger.rows.map((row) =>
        row.sessionId === cursorNames ? { ...row, updatedAt: "2026-12-31T00:00:00.000Z" } : row);
    });
    assert.deepEqual(walk.served, SIX_IN_ORDER);
  });
});

test("a conversation created mid-walk sorts above the cursor and waits for the next read", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const ledger = { rows: ledgerOfSix() };
    const walk = await walkAcrossMutation(runtime, bearer, ledger, () => {
      ledger.rows = [
        ...ledger.rows,
        summary("conversation-new", "2026-12-31T00:00:00.000Z"),
      ];
    });
    // Every pre-existing row exactly once, and the new one left for a read from
    // the top. That is inherent to a forward keyset over a growing set — it
    // costs no row that existed when the walk began, which is the difference
    // between this and the skip.
    assert.deepEqual(walk.served, SIX_IN_ORDER);
    assert.equal(walk.served.includes("conversation-new"), false);
  });
});

test("a conversation deleted mid-walk does not strand the rest of the walk", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const ledger = { rows: ledgerOfSix() };
    let deleted = "";
    const walk = await walkAcrossMutation(runtime, bearer, ledger, (served) => {
      deleted = SIX_IN_ORDER.filter((id) => !served.includes(id))[0];
      ledger.rows = ledger.rows.filter((row) => row.sessionId !== deleted);
    });
    assert.equal(deleted, "conversation-04");
    assert.deepEqual(walk.served, SIX_IN_ORDER.filter((id) => id !== deleted));
    assert.ok(walk.statuses.every((status) => status === 200));
  });
});

test("a conversation with no createdAt is served at the tail rather than stranded", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    // A transcript written before the field existed, and the fallback row a
    // corrupt file produces, both reach the projection with no createdAt. They
    // are the reason #4856 rejected this key; the empty-string sentinel is the
    // answer, and it has to be reachable THROUGH a cursor, not just present.
    const keyless: ConversationSummary = {
      sessionId: "conversation-keyless",
      familiarId: "",
      // The newest updatedAt in the set, so an updatedAt-keyed route would put
      // it first. It must still come last.
      updatedAt: "2036-01-01T00:00:00.000Z",
    };
    const ledger = { rows: [...ledgerOfSix(), keyless] };
    const walk = await walkAcrossMutation(runtime, bearer, ledger, () => {});
    assert.deepEqual(walk.served, [...SIX_IN_ORDER, "conversation-keyless"]);

    const handler = createClientV1ConversationsGetHandler(
      runtime,
      sources({ listConversations: async () => ledger.rows }),
    );
    const response = await handler(request("?limit=100", { authorization: `Bearer ${bearer}` }));
    const body = await response.json() as { data: { conversations: Record<string, unknown>[] } };
    const row = body.data.conversations.at(-1)!;
    assert.equal(row.id, "conversation-keyless");
    assert.equal("createdAt" in row, false, "the record must not invent a createdAt the store lacks");
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

test("bound conversation lists encrypt results and reject downgrade or path drift before stores, budgets, and sources", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 71 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-conversations",
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
        const handler = createClientV1ConversationsGetHandler(
          runtime,
          sources({
            listConversations: async () => {
              sourceCalls += 1;
              return LEDGER;
            },
          }),
        );

        const downgrade = await handler(
          request("", { authorization: ["Bearer", issued.bearer].join(" ") }),
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
          operation: "conversations.list",
          url: "http://127.0.0.1:3020/api/client/v1/conversations",
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(14),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const valid = await handler(
          new Request(prepared.request, { headers }),
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
            data: { conversations: { id: string }[] };
          }).data.conversations.map(({ id }) => id),
          ["conversation-b", "conversation-a", "conversation-c"],
        );
        assert.deepEqual({ findCalls, chargeCalls, sourceCalls }, {
          findCalls: 1,
          chargeCalls: 1,
          sourceCalls: 1,
        });

        const beforePathDrift = { findCalls, chargeCalls, sourceCalls };
        const wrongPath = await handler(
          new Request(
            "http://127.0.0.1:3020/api/client/v1/conversations/other",
            { headers },
          ),
        );
        assert.equal(wrongPath.status, 400);
        assert.deepEqual(
          { findCalls, chargeCalls, sourceCalls },
          beforePathDrift,
        );
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
