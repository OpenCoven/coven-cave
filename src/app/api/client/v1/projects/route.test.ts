import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { CaveProject } from "@/lib/cave-projects-types.ts";
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

test("a project created between two pages cannot displace one already served", async () => {
  // This is why the page key is createdAt and not updatedAt. Touching alpha
  // moves it to the top of an updatedAt ordering, and a cursor holding a
  // *later* timestamp would then skip it entirely.
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
      row.id === "delta" ? { ...row, updatedAt: "2026-08-30T00:00:00.000Z" } : row);

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
