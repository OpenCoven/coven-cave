import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { decodeClientV1Cursor, encodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import { CLIENT_V1_AUTHENTICATED_LIMIT } from "@/lib/server/client-v1/rate-limit.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import type { VisibleFamiliarRosterEntry } from "@/lib/server/familiar-roster.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1FamiliarsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-familiars-");
const STAMP = "loopback-secret";

function roster(...ids: string[]): VisibleFamiliarRosterEntry[] {
  return ids.map((id) => ({ id, display_name: id.toUpperCase(), role: "Familiar" }));
}

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: async () => ({
      ok: true,
      config: {} as never,
      target: {} as never,
      roster: roster("adept", "mote", "warden"),
    }),
    listProjects: unsupported,
    listConversations: unsupported,
    loadConversation: unsupported,
    ...overrides,
  };
}

function request(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3020/api/client/v1/familiars${query}`, {
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

test("a paired credential reads the roster in a total id order", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      capabilities: string[];
      cursor?: unknown;
      data: { familiars: { id: string; displayName: string; role: string }[] };
    };
    assert.deepEqual(body.data.familiars.map((entry) => entry.id), ["adept", "mote", "warden"]);
    assert.deepEqual(body.data.familiars[0], {
      id: "adept",
      displayName: "ADEPT",
      role: "Familiar",
    });
    // The whole roster fits one page, so there is no cursor token to publish.
    assert.equal("cursor" in body, false);
    assert.ok(body.capabilities.includes("familiars"));
  });
});

test("the roster pages through a cursor and stops without repeating a familiar", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    const first = await handler(request("?limit=2", { authorization }));
    const firstBody = await first.json() as {
      cursor: { next: string; hasMore: boolean };
      data: { familiars: { id: string }[] };
    };
    assert.deepEqual(firstBody.data.familiars.map((entry) => entry.id), ["adept", "mote"]);
    assert.equal(firstBody.cursor.hasMore, true);

    const second = await handler(
      request(`?limit=2&cursor=${encodeURIComponent(firstBody.cursor.next)}`, { authorization }),
    );
    const secondBody = await second.json() as {
      cursor: { current: string; next?: string; hasMore: boolean };
      data: { familiars: { id: string }[] };
    };
    assert.deepEqual(secondBody.data.familiars.map((entry) => entry.id), ["warden"]);
    assert.equal(secondBody.cursor.hasMore, false);
    assert.equal(secondBody.cursor.next, undefined);
    assert.equal(secondBody.cursor.current, firstBody.cursor.next);
    assert.deepEqual(decodeClientV1Cursor(firstBody.cursor.next), { sort: "mote", id: "mote" });
  });
});

test("an unreadable roster is service_unavailable, never a credential problem", async () => {
  // The daemon rejecting Cave's own access token says nothing about the
  // client's bearer. Answering 401 here would tell a correctly paired client to
  // throw its credential away and re-pair, which cannot fix a daemon outage.
  for (const status of [401, 403, 503]) {
    await withRuntime(["chat:read"], async (runtime, bearer) => {
      const handler = createClientV1FamiliarsGetHandler(
        runtime,
        sources({
          listFamiliars: async () => ({
            ok: false,
            config: {} as never,
            target: {} as never,
            status,
            error: `daemon http ${status}`,
          }),
        }),
      );
      const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
      assert.equal(response.status, 503, `daemon ${status}`);
      const body = await response.json() as { error: { code: string; retryable: boolean } };
      assert.equal(body.error.code, "service_unavailable");
      assert.equal(body.error.retryable, true);
    });
  }
});

test("an empty roster is an empty page with no cursor rather than a 404", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(
      runtime,
      sources({
        listFamiliars: async () => ({
          ok: true,
          config: {} as never,
          target: {} as never,
          roster: [],
        }),
      }),
    );
    const response = await handler(request("", { authorization: `Bearer ${bearer}` }));
    assert.equal(response.status, 200);
    const body = await response.json() as { cursor?: unknown; data: { familiars: unknown[] } };
    assert.deepEqual(body.data.familiars, []);
    assert.equal("cursor" in body, false);
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());

    // No bearer at all.
    assert.equal((await handler(request())).status, 401);
    // A bearer nothing issued.
    assert.equal(
      (await handler(request("", { authorization: "Bearer not-a-real-bearer" }))).status,
      401,
    );
    // A credential that exists but was not granted chat:read.
    const denied = await handler(
      request("", { authorization: `Bearer ${writeOnlyBearer}` }),
    );
    assert.equal(denied.status, 403);
    assert.equal(
      (await denied.json() as { error: { code: string } }).error.code,
      "scope_denied",
    );
    // A credential presented without the listener's loopback stamp. The proxy
    // classifies this path as client-v1 ingress and would normally refuse a
    // non-loopback peer before the route runs — but a percent-encoded path
    // segment escapes that classification entirely (#4854), so the route must
    // not be the layer that assumes it ran.
    const unstamped = new Request("http://127.0.0.1:3020/api/client/v1/familiars", {
      headers: { authorization: `Bearer ${writeOnlyBearer}` },
    });
    assert.equal((await handler(unstamped)).status, 401);
  });
});

test("a revoked credential stops reading immediately", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    assert.equal((await handler(request("", { authorization }))).status, 200);
    const records = await runtime.credentialStore.reload();
    const [id] = [...records.keys()];
    await runtime.credentialStore.revoke(id, "test");
    assert.equal((await handler(request("", { authorization }))).status, 401);
  });
});

test("the route refuses a query it does not serve instead of guessing a page", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const query of [
      `?limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`,
      "?limit=0",
      "?cursor=not%2Ba%2Bcursor",
      "?offset=10",
    ]) {
      const response = await handler(request(query, { authorization }));
      assert.equal(response.status, 400, query);
      const body = await response.json() as { error: { code: string; details?: unknown } };
      assert.equal(body.error.code, "invalid_request", query);
      assert.notEqual(body.error.details, undefined, query);
    }
    // A cursor this Cave really minted, for a familiar that has since been
    // removed, resumes at the next surviving row rather than failing.
    const removed = encodeClientV1Cursor({ sort: "adept", id: "adept" });
    const response = await handler(
      request(`?cursor=${encodeURIComponent(removed)}`, { authorization }),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { familiars: { id: string }[] } };
    assert.deepEqual(body.data.familiars.map((entry) => entry.id), ["mote", "warden"]);
  });
});

test("a paired credential's reads are bounded by its own authenticated budget", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarsGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (let attempt = 0; attempt < CLIENT_V1_AUTHENTICATED_LIMIT; attempt += 1) {
      assert.equal((await handler(request("", { authorization }))).status, 200, `attempt ${attempt}`);
    }
    const throttled = await handler(request("", { authorization }));
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("retry-after"), "60");
  });
});

test("the roster is never read before the credential is checked", async () => {
  // A read that runs first is a read an unauthenticated caller can trigger: on
  // this route that is a live daemon request, which is both a side effect and a
  // timing signal.
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarsGetHandler(
      runtime,
      sources({
        listFamiliars: async () => {
          reads += 1;
          return { ok: true, config: {} as never, target: {} as never, roster: [] };
        },
      }),
    );
    await handler(request());
    await handler(request("", { authorization: "Bearer not-a-real-bearer" }));
    await handler(request("", { authorization: `Bearer ${writeOnlyBearer}` }));
    assert.equal(reads, 0);
  });
});
