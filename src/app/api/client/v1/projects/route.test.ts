import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { CaveProject } from "@/lib/cave-projects-types.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { encodeClientV1Cursor } from "@/lib/server/client-v1/pagination.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1ProjectsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-projects-");
const STAMP = "loopback-secret";

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
