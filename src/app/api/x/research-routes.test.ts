import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { XApiError, type NormalizedXPost } from "../../../lib/x-api.ts";

const lookupSource = readFileSync(new URL("./posts/lookup/route.ts", import.meta.url), "utf8");
const searchSource = readFileSync(new URL("./posts/search/route.ts", import.meta.url), "utf8");
const sourcesSource = readFileSync(new URL("./sources/route.ts", import.meta.url), "utf8");

for (const [name, source, methods] of [
  ["lookup", lookupSource, ["POST"]],
  ["search", searchSource, ["POST"]],
  ["sources", sourcesSource, ["GET", "POST", "DELETE"]],
] as const) {
  for (const method of methods) {
    assert.match(source, new RegExp(`export async function ${method}\\(req: Request\\)`), `${name} exports ${method}`);
  }
  assert.match(source, /rejectNonLocalRequest/);
  assert.match(source, /sweepExpiredXCache/);
  assert.match(source, /isValidFamiliarId/);
  assert.match(source, /requireXCapability|withXAuthenticatedRead/);
}
assert.match(lookupSource, /readJsonBody/);
assert.match(searchSource, /readJsonBody/);
assert.match(sourcesSource, /readJsonBody/);
assert.match(lookupSource, /parseXPostUrl[\s\S]*withXAuthenticatedRead/);
assert.match(searchSource, /searchRecentXPosts/);
assert.match(lookupSource, /cacheNormalizedXPosts/);
assert.match(searchSource, /cacheNormalizedXPosts/);
assert.doesNotMatch(lookupSource, /console\./);
assert.doesNotMatch(searchSource, /console\./);
assert.doesNotMatch(sourcesSource, /console\./);

const { createXPostLookupHandler } = await import("./posts/lookup/route.ts");
const { createXPostSearchHandler } = await import("./posts/search/route.ts");
const { createXSourcesHandlers } = await import("./sources/route.ts");

const post = (id = "100"): NormalizedXPost => ({
  id,
  canonicalUrl: `https://x.com/opencoven/status/${id}`,
  text: `post ${id}`,
  author: { id: "42", username: "opencoven", name: "Open Coven" },
  createdAt: "2026-07-31T12:00:00.000Z",
});

function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function safeError(error: unknown): Response {
  if (error instanceof XApiError) {
    const statuses = {
      "invalid-request": 400,
      "capability-disabled": 403,
      "not-found": 404,
    } as const;
    return Response.json({
      ok: false,
      code: error.code,
      error: error.safeMessage,
    }, { status: statuses[error.code as keyof typeof statuses] ?? 500 });
  }
  return Response.json({
    ok: false,
    code: "internal",
    error: "X request could not be completed",
  }, { status: 500 });
}

function parsedBody<T>(body: T) {
  return async (_req: Request, maxBytes: number) => {
    assert.equal(maxBytes, 16 * 1024);
    return { ok: true as const, body };
  };
}

test("lookup parses locally, performs one visible read, and caches the normalized success", async () => {
  const calls: string[] = [];
  const normalized = post();
  const handler = createXPostLookupHandler({
    rejectNonLocalRequest: () => null,
    readJsonBody: parsedBody({
      familiarId: "nova",
      url: "https://twitter.com/OpenCoven/status/100?ref=desk",
    }),
    sweepExpiredCache: async () => {
      calls.push("sweep");
      return 0;
    },
    withAuthenticatedRead: async (familiarId, scopes, operation) => {
      assert.equal(familiarId, "nova");
      assert.deepEqual(scopes, ["tweet.read", "users.read"]);
      calls.push("read");
      return operation("access-token");
    },
    lookupPost: async (token, postId) => {
      assert.equal(token, "access-token");
      assert.equal(postId, "100");
      calls.push("lookup");
      return normalized;
    },
    cachePosts: async (posts) => {
      assert.deepEqual(posts, [normalized]);
      calls.push("cache");
    },
    markAvailability: async () => {
      calls.push("mark");
    },
    errorResponse: safeError,
  });

  const response = await handler(jsonRequest("/api/x/posts/lookup", {}));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, post: normalized });
  assert.deepEqual(calls, ["sweep", "read", "lookup", "cache"]);
});

test("lookup rejects an oversized or invalid URL without echoing it or calling X", async () => {
  const invalidUrl = `https://attacker.invalid/${"secret".repeat(400)}`;
  let xCalls = 0;
  const handler = createXPostLookupHandler({
    rejectNonLocalRequest: () => null,
    readJsonBody: parsedBody({ familiarId: "nova", url: invalidUrl }),
    sweepExpiredCache: async () => 0,
    withAuthenticatedRead: async (_familiarId, _scopes, operation) => {
      xCalls += 1;
      return operation("access-token");
    },
    lookupPost: async () => {
      xCalls += 1;
      return post();
    },
    cachePosts: async () => {},
    markAvailability: async () => {},
    errorResponse: safeError,
  });

  const response = await handler(jsonRequest("/api/x/posts/lookup", {}));
  assert.equal(response.status, 400);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes(invalidUrl), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(xCalls, 0);
});

test("lookup 404 purges cache through availability marking before returning a safe error", async () => {
  const calls: string[] = [];
  const handler = createXPostLookupHandler({
    rejectNonLocalRequest: () => null,
    readJsonBody: parsedBody({
      familiarId: "nova",
      url: "https://x.com/opencoven/status/100",
    }),
    sweepExpiredCache: async () => 0,
    withAuthenticatedRead: async (_familiarId, _scopes, operation) => operation("access-token"),
    lookupPost: async () => {
      calls.push("lookup");
      throw new XApiError("not-found", "X resource was not found", { status: 404 });
    },
    cachePosts: async () => {
      calls.push("cache");
    },
    markAvailability: async (postId, availability) => {
      assert.equal(postId, "100");
      assert.equal(availability, "deleted");
      calls.push("mark");
    },
    errorResponse: safeError,
  });

  const response = await handler(jsonRequest("/api/x/posts/lookup", {}));
  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["lookup", "mark"]);
});

test("search performs one bounded recent-search operation and caches at most ten posts", async () => {
  let searches = 0;
  const found = Array.from({ length: 12 }, (_, index) => post(String(100 + index)));
  let cached: NormalizedXPost[] = [];
  const handler = createXPostSearchHandler({
    rejectNonLocalRequest: () => null,
    readJsonBody: parsedBody({ familiarId: "nova", query: "from:opencoven cave" }),
    sweepExpiredCache: async () => 0,
    withAuthenticatedRead: async (familiarId, scopes, operation) => {
      assert.equal(familiarId, "nova");
      assert.deepEqual(scopes, ["tweet.read", "users.read"]);
      return operation("access-token");
    },
    searchPosts: async (token, query) => {
      assert.equal(token, "access-token");
      assert.equal(query, "from:opencoven cave");
      searches += 1;
      return found;
    },
    cachePosts: async (posts) => {
      cached = posts;
    },
    errorResponse: safeError,
  });

  const response = await handler(jsonRequest("/api/x/posts/search", {}));
  assert.equal(response.status, 200);
  const body = await response.json() as { posts: NormalizedXPost[] };
  assert.equal(searches, 1);
  assert.equal(body.posts.length, 10);
  assert.deepEqual(cached, found.slice(0, 10));
});

test("search rejects empty and overlong queries without echoing or calling X", async () => {
  for (const query of ["   ", "private ".repeat(100)]) {
    let searches = 0;
    const handler = createXPostSearchHandler({
      rejectNonLocalRequest: () => null,
      readJsonBody: parsedBody({ familiarId: "nova", query }),
      sweepExpiredCache: async () => 0,
      withAuthenticatedRead: async (_familiarId, _scopes, operation) => operation("access-token"),
      searchPosts: async () => {
        searches += 1;
        return [];
      },
      cachePosts: async () => {},
      errorResponse: safeError,
    });
    const response = await handler(jsonRequest("/api/x/posts/search", {}));
    assert.equal(response.status, 400);
    const serialized = JSON.stringify(await response.json());
    if (query.trim()) assert.equal(serialized.includes(query.trim()), false);
    assert.equal(searches, 0);
  }
});

const savedSource = {
  id: "source-one",
  familiarId: "nova",
  postId: "100",
  canonicalUrl: "https://x.com/opencoven/status/100",
  originalUrl: "https://twitter.com/OpenCoven/status/100",
  note: "Primary source",
  tags: ["research"],
  addedAt: "2026-07-31T12:00:00.000Z",
  updatedAt: "2026-07-31T12:00:00.000Z",
  attachedMissionIds: [] as string[],
  availability: "available" as const,
};

function sourceDependencies(overrides: Record<string, unknown> = {}) {
  return {
    rejectNonLocalRequest: () => null,
    readJsonBody: parsedBody({ action: "save", familiarId: "nova" }),
    sweepExpiredCache: async () => 0,
    requireResearch: async () => {},
    listSources: async () => [savedSource],
    getCachedPost: async () => post(),
    saveCachedSource: async () => ({ source: savedSource, created: true }),
    refreshSource: async () => ({ source: savedSource, created: false as const }),
    removeSource: async () => true,
    markAvailability: async () => {},
    reconcileAttachments: async () => [savedSource],
    listMissions: async () => [],
    loadMission: async () => null,
    makeRunner: () => ({ act: async () => ({ id: "mission-one" }) }),
    setMissionAttached: async () => {},
    withAuthenticatedRead: async (
      _familiarId: string,
      _scopes: string[],
      operation: (token: string) => Promise<NormalizedXPost>,
    ) => operation("access-token"),
    lookupPost: async () => post(),
    errorResponse: safeError,
    ...overrides,
  };
}

test("sources save is bounded, requires a cached normalized post, and persists identity only", async () => {
  let upsertInput: Record<string, unknown> | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "save",
      familiarId: "nova",
      postId: "100",
      originalUrl: "https://twitter.com/OpenCoven/status/100",
      note: "Primary source",
      tags: ["research"],
    }),
    saveCachedSource: async (input: Record<string, unknown>) => {
      upsertInput = input;
      return { source: savedSource, created: true };
    },
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 200);
  assert.deepEqual(upsertInput, {
    familiarId: "nova",
    postId: "100",
    originalUrl: "https://twitter.com/OpenCoven/status/100",
    note: "Primary source",
    tags: ["research"],
  });
  assert.equal(JSON.stringify(upsertInput).includes("post 100"), false);
});

test("sources attach proves familiar ownership, invokes the exact runner action, then records the link", async () => {
  const calls: string[] = [];
  let actionInput: unknown;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: "source-one",
      missionId: "mission-one",
    }),
    listSources: async () => {
      calls.push("source");
      return [savedSource];
    },
    loadMission: async () => {
      calls.push("mission");
      return { id: "mission-one", familiarId: "nova", sources: [] };
    },
    makeRunner: () => ({
      act: async (_missionId: string, input: unknown) => {
        calls.push("act");
        actionInput = input;
        return { id: "mission-one" };
      },
    }),
    setMissionAttached: async () => {
      calls.push("link");
    },
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["source", "mission", "act", "link"]);
  assert.deepEqual(actionInput, {
    action: "attach-source",
    source: {
      id: "source-one",
      title: "https://x.com/opencoven/status/100",
      url: "https://x.com/opencoven/status/100",
      sourceType: "x-post",
      provider: "x",
      externalId: "100",
      availability: "available",
      note: "Primary source",
      status: "candidate",
    },
  });
});

test("sources attach never updates the source store when the mission action fails", async () => {
  let linkCalls = 0;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: "source-one",
      missionId: "mission-one",
    }),
    loadMission: async () => ({ id: "mission-one", familiarId: "nova", sources: [] }),
    makeRunner: () => ({
      act: async () => {
        throw new Error("mission write failed with private path");
      },
    }),
    setMissionAttached: async () => {
      linkCalls += 1;
    },
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 500);
  assert.equal(linkCalls, 0);
  assert.equal(JSON.stringify(await response.json()).includes("private path"), false);
});

test("a source-store failure after mission attach is explicit and GET reconciliation converges", async () => {
  let reconcileInput: ReadonlyMap<string, readonly string[]> | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: "source-one",
      missionId: "mission-one",
    }),
    loadMission: async () => ({ id: "mission-one", familiarId: "nova", sources: [] }),
    makeRunner: () => ({
      act: async () => ({ id: "mission-one" }),
    }),
    setMissionAttached: async () => {
      throw new Error("source store unavailable");
    },
    listMissions: async () => [{
      id: "mission-one",
      familiarId: "nova",
      sources: [{ id: "source-one" }],
    }],
    reconcileAttachments: async (
      _familiarId: string,
      attachments: ReadonlyMap<string, readonly string[]>,
    ) => {
      reconcileInput = attachments;
      return [{ ...savedSource, attachedMissionIds: ["mission-one"] }];
    },
  }));

  const attachResponse = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(attachResponse.status, 500);
  const getResponse = await handlers.GET(new Request("http://127.0.0.1/api/x/sources?familiarId=nova"));
  assert.equal(getResponse.status, 200);
  assert.deepEqual(reconcileInput && [...reconcileInput], [["source-one", ["mission-one"]]]);
  const body = await getResponse.json() as { sources: Array<{ attachedMissionIds: string[] }> };
  assert.deepEqual(body.sources[0].attachedMissionIds, ["mission-one"]);
});

test("attach then GET reconciles a runner-preserved same-URL mission source id", async () => {
  const mission = {
    id: "mission-one",
    familiarId: "nova",
    sources: [{
      id: "pre-existing-source",
      url: savedSource.canonicalUrl,
    }],
  };
  let attachedMissionIds: string[] = [];
  let reconcileInput: ReadonlyMap<string, readonly string[]> | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: savedSource.id,
      missionId: mission.id,
    }),
    listSources: async () => [{ ...savedSource, attachedMissionIds }],
    loadMission: async () => mission,
    makeRunner: () => ({
      act: async (_missionId: string, input: {
        source?: { url?: string };
      }) => {
        assert.equal(input.source?.url, savedSource.canonicalUrl);
        return mission;
      },
    }),
    setMissionAttached: async (_familiarId: string, _sourceId: string, missionId: string) => {
      attachedMissionIds = [missionId];
    },
    listMissions: async () => [mission],
    reconcileAttachments: async (
      _familiarId: string,
      attachments: ReadonlyMap<string, readonly string[]>,
    ) => {
      reconcileInput = attachments;
      attachedMissionIds = [...(attachments.get(savedSource.id) ?? [])];
      return [{ ...savedSource, attachedMissionIds }];
    },
  }));

  const attachResponse = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(attachResponse.status, 200);
  const getResponse = await handlers.GET(
    new Request("http://127.0.0.1/api/x/sources?familiarId=nova"),
  );
  assert.equal(getResponse.status, 200);
  assert.deepEqual(
    reconcileInput && [...reconcileInput],
    [[savedSource.id, [mission.id]]],
  );
  const body = await getResponse.json() as {
    sources: Array<{ attachedMissionIds: string[] }>;
  };
  assert.deepEqual(body.sources[0].attachedMissionIds, [mission.id]);
});

test("sources attach hides cross-familiar missions and does not invoke the runner", async () => {
  let acts = 0;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: "source-one",
      missionId: "mission-one",
    }),
    loadMission: async () => ({ id: "mission-one", familiarId: "wren", sources: [] }),
    makeRunner: () => ({
      act: async () => {
        acts += 1;
        return { id: "mission-one" };
      },
    }),
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 404);
  assert.equal(acts, 0);
});

test("sources refresh uses the read helper, caches success, and restores availability", async () => {
  const refreshed = post();
  const calls: string[] = [];
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "refresh",
      familiarId: "nova",
      sourceId: "source-one",
    }),
    withAuthenticatedRead: async (
      familiarId: string,
      scopes: string[],
      operation: (token: string) => Promise<NormalizedXPost>,
    ) => {
      assert.equal(familiarId, "nova");
      assert.deepEqual(scopes, ["tweet.read", "users.read"]);
      calls.push("read");
      return operation("access-token");
    },
    lookupPost: async () => {
      calls.push("lookup");
      return refreshed;
    },
    refreshSource: async () => {
      calls.push("persist");
      return { source: savedSource, created: false as const };
    },
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["read", "lookup", "persist"]);
});

test("sources refresh 404 purges cache and marks durable availability", async () => {
  const calls: string[] = [];
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "refresh",
      familiarId: "nova",
      sourceId: "source-one",
    }),
    lookupPost: async () => {
      throw new XApiError("not-found", "X resource was not found", { status: 404 });
    },
    markAvailability: async (postId: string, availability: string) => {
      assert.equal(postId, "100");
      assert.equal(availability, "deleted");
      calls.push("mark");
    },
  }));

  const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["mark"]);
});

test("sources GET requires the grant, reconciles mission ledgers, and includes only cached previews", async () => {
  const calls: string[] = [];
  const handlers = createXSourcesHandlers(sourceDependencies({
    requireResearch: async (familiarId: string) => {
      assert.equal(familiarId, "nova");
      calls.push("grant");
    },
    listMissions: async () => [{
      id: "mission-one",
      familiarId: "nova",
      sources: [{ id: "source-one" }],
    }, {
      id: "mission-other",
      familiarId: "wren",
      sources: [{ id: "source-one" }],
    }],
    reconcileAttachments: async (
      familiarId: string,
      attachments: ReadonlyMap<string, readonly string[]>,
    ) => {
      assert.equal(familiarId, "nova");
      assert.deepEqual([...attachments], [["source-one", ["mission-one"]]]);
      calls.push("reconcile");
      return [{ ...savedSource, attachedMissionIds: ["mission-one"] }];
    },
    getCachedPost: async (postId: string) => {
      assert.equal(postId, "100");
      calls.push("preview");
      return post();
    },
  }));

  const response = await handlers.GET(new Request("http://127.0.0.1/api/x/sources?familiarId=nova"));
  assert.equal(response.status, 200);
  const body = await response.json() as { sources: Array<{ preview?: NormalizedXPost }> };
  assert.deepEqual(body.sources[0].preview, post());
  assert.deepEqual(calls, ["grant", "reconcile", "preview"]);
});

test("sources DELETE validates and removes only the familiar-scoped source", async () => {
  let removed: [string, string] | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({ familiarId: "nova", sourceId: "source-one" }),
    removeSource: async (familiarId: string, sourceId: string) => {
      removed = [familiarId, sourceId];
      return true;
    },
  }));

  const response = await handlers.DELETE(jsonRequest("/api/x/sources", {}, "DELETE"));
  assert.equal(response.status, 200);
  assert.deepEqual(removed, ["nova", "source-one"]);
});

test("source action bounds reject notes, tags, identifiers, and unknown actions safely", async () => {
  const invalidBodies = [
    {
      action: "save",
      familiarId: "nova",
      postId: "100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: "n".repeat(2_001),
      tags: [],
    },
    {
      action: "save",
      familiarId: "nova",
      postId: "100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: "",
      tags: Array.from({ length: 26 }, () => "tag"),
    },
    { action: "attach", familiarId: "nova", sourceId: "s".repeat(129), missionId: "mission-one" },
    { action: "unknown", familiarId: "nova" },
  ];
  for (const body of invalidBodies) {
    const handlers = createXSourcesHandlers(sourceDependencies({
      readJsonBody: parsedBody(body),
    }));
    const response = await handlers.POST(jsonRequest("/api/x/sources", {}));
    assert.equal(response.status, 400);
    const serialized = JSON.stringify(await response.json());
    assert.equal(serialized.includes("n".repeat(100)), false);
  }
});

console.log("research-routes.test.ts: ok");
