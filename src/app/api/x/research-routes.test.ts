import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { XApiError, type NormalizedXPost } from "../../../lib/x-api.ts";

const execFileAsync = promisify(execFile);
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createFamiliarLifecycleLock() {
  const tails = new Map<string, Promise<void>>();
  return async function withLifecycleLock<T>(
    familiarId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = tails.get(familiarId) ?? Promise.resolve();
    let release!: () => void;
    const owned = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => owned);
    tails.set(familiarId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      await tail;
      if (tails.get(familiarId) === tail) tails.delete(familiarId);
    }
  };
}

async function waitForFile(target: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(target, "utf8");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path.basename(target)}`);
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
    withLifecycleLock: async <T>(
      _familiarId: string,
      operation: () => Promise<T>,
    ): Promise<T> => operation(),
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
    withLifecycleLock: async <T>(
      _familiarId: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      calls.push("lock-enter");
      try {
        return await operation();
      } finally {
        calls.push("lock-exit");
      }
    },
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
  assert.deepEqual(calls, ["lock-enter", "source", "mission", "act", "link", "lock-exit"]);
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

test("delete-before-attach returns not found without mutating the mission", async () => {
  const sharedLifecycleLock = createFamiliarLifecycleLock();
  const contenderQueued = deferred();
  let lifecycleCalls = 0;
  const withLifecycleLock = async <T>(
    familiarId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    lifecycleCalls += 1;
    if (lifecycleCalls === 2) contenderQueued.resolve();
    return sharedLifecycleLock(familiarId, operation);
  };
  const deleteEntered = deferred();
  const allowDelete = deferred();
  let sourceExists = true;
  let listCalls = 0;
  let acts = 0;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: async (req: Request) => ({
      ok: true as const,
      body: req.method === "DELETE"
        ? { familiarId: "nova", sourceId: "source-one" }
        : {
            action: "attach",
            familiarId: "nova",
            sourceId: "source-one",
            missionId: "mission-one",
          },
    }),
    withLifecycleLock,
    listSources: async () => {
      listCalls += 1;
      return sourceExists ? [savedSource] : [];
    },
    removeSource: async () => {
      deleteEntered.resolve();
      await allowDelete.promise;
      sourceExists = false;
      return true;
    },
    loadMission: async () => ({ id: "mission-one", familiarId: "nova", sources: [] }),
    makeRunner: () => ({
      act: async () => {
        acts += 1;
        return { id: "mission-one" };
      },
    }),
  }));

  const deleting = handlers.DELETE(jsonRequest("/api/x/sources", {}, "DELETE"));
  await deleteEntered.promise;
  const attaching = handlers.POST(jsonRequest("/api/x/sources", {}));
  await contenderQueued.promise;
  assert.equal(listCalls, 0);
  allowDelete.resolve();

  assert.equal((await deleting).status, 200);
  assert.equal((await attaching).status, 404);
  assert.equal(acts, 0);
});

test("attach-before-delete succeeds before the source is removed", async () => {
  const sharedLifecycleLock = createFamiliarLifecycleLock();
  const contenderQueued = deferred();
  let lifecycleCalls = 0;
  const withLifecycleLock = async <T>(
    familiarId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    lifecycleCalls += 1;
    if (lifecycleCalls === 2) contenderQueued.resolve();
    return sharedLifecycleLock(familiarId, operation);
  };
  const runnerEntered = deferred();
  const allowRunner = deferred();
  let sourceExists = true;
  let removeCalls = 0;
  const mission = { id: "mission-one", familiarId: "nova", sources: [] as Array<{ id: string }> };
  let attachedMissionIds: string[] = [];
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: async (req: Request) => ({
      ok: true as const,
      body: req.method === "DELETE"
        ? { familiarId: "nova", sourceId: "source-one" }
        : {
            action: "attach",
            familiarId: "nova",
            sourceId: "source-one",
            missionId: "mission-one",
          },
    }),
    withLifecycleLock,
    listSources: async () => sourceExists ? [{ ...savedSource, attachedMissionIds }] : [],
    loadMission: async () => mission,
    makeRunner: () => ({
      act: async () => {
        runnerEntered.resolve();
        await allowRunner.promise;
        mission.sources.push({ id: "source-one" });
        return mission;
      },
    }),
    setMissionAttached: async () => {
      assert.equal(sourceExists, true);
      attachedMissionIds = ["mission-one"];
    },
    removeSource: async () => {
      removeCalls += 1;
      sourceExists = false;
      return true;
    },
  }));

  const attaching = handlers.POST(jsonRequest("/api/x/sources", {}));
  await runnerEntered.promise;
  const deleting = handlers.DELETE(jsonRequest("/api/x/sources", {}, "DELETE"));
  await contenderQueued.promise;
  assert.equal(removeCalls, 0);
  allowRunner.resolve();

  assert.equal((await attaching).status, 200);
  assert.equal((await deleting).status, 200);
  assert.equal(sourceExists, false);
  assert.deepEqual(mission.sources, [{ id: "source-one" }]);
});

test("a stale GET reconciliation linearizes before attach and cannot erase its completed link", async () => {
  const sharedLifecycleLock = createFamiliarLifecycleLock();
  const contenderQueued = deferred();
  let lifecycleCalls = 0;
  const withLifecycleLock = async <T>(
    familiarId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    lifecycleCalls += 1;
    if (lifecycleCalls === 2) contenderQueued.resolve();
    return sharedLifecycleLock(familiarId, operation);
  };
  const missionSnapshotTaken = deferred();
  const allowReconciliation = deferred();
  const calls: string[] = [];
  const mission = {
    id: "mission-one",
    familiarId: "nova",
    sources: [] as Array<{ id: string }>,
  };
  let attachedMissionIds: string[] = ["mission-stale"];
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: "source-one",
      missionId: "mission-one",
    }),
    withLifecycleLock,
    listSources: async () => [{ ...savedSource, attachedMissionIds }],
    listMissions: async () => {
      calls.push("snapshot");
      missionSnapshotTaken.resolve();
      return [];
    },
    reconcileAttachments: async () => {
      calls.push("reconcile");
      await allowReconciliation.promise;
      attachedMissionIds = [];
      return [{ ...savedSource, attachedMissionIds }];
    },
    getCachedPost: async () => null,
    loadMission: async () => mission,
    makeRunner: () => ({
      act: async () => {
        calls.push("act");
        mission.sources.push({ id: "source-one" });
        return mission;
      },
    }),
    setMissionAttached: async () => {
      calls.push("link");
      attachedMissionIds = ["mission-one"];
    },
  }));

  const getting = handlers.GET(
    new Request("http://127.0.0.1/api/x/sources?familiarId=nova"),
  );
  await missionSnapshotTaken.promise;
  const attaching = handlers.POST(jsonRequest("/api/x/sources", {}));
  await contenderQueued.promise;
  assert.deepEqual(calls, ["snapshot", "reconcile"]);
  allowReconciliation.resolve();

  assert.equal((await getting).status, 200);
  assert.equal((await attaching).status, 200);
  assert.deepEqual(calls, ["snapshot", "reconcile", "act", "link"]);
  assert.deepEqual(attachedMissionIds, ["mission-one"]);
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

test("attach then GET reconciles a runner-preserved X post after its handle changed", async () => {
  const changedHandleSource = {
    ...savedSource,
    canonicalUrl: "https://x.com/new_handle/status/100",
  };
  const mission = {
    id: "mission-one",
    familiarId: "nova",
    sources: [{
      id: "pre-existing-source",
      url: "https://x.com/old_handle/status/100",
    }],
  };
  let attachedMissionIds: string[] = [];
  let reconcileInput: ReadonlyMap<string, readonly string[]> | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    readJsonBody: parsedBody({
      action: "attach",
      familiarId: "nova",
      sourceId: changedHandleSource.id,
      missionId: mission.id,
    }),
    listSources: async () => [{ ...changedHandleSource, attachedMissionIds }],
    loadMission: async () => mission,
    makeRunner: () => ({
      act: async (_missionId: string, input: {
        source?: { url?: string };
      }) => {
        assert.equal(input.source?.url, changedHandleSource.canonicalUrl);
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
      attachedMissionIds = [...(attachments.get(changedHandleSource.id) ?? [])];
      return [{ ...changedHandleSource, attachedMissionIds }];
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
    [[changedHandleSource.id, [mission.id]]],
  );
  const body = await getResponse.json() as {
    sources: Array<{ attachedMissionIds: string[] }>;
  };
  assert.deepEqual(body.sources[0].attachedMissionIds, [mission.id]);
});

test("sources GET ignores invalid mission URLs and refuses ambiguous post-id fallback", async () => {
  const duplicate = {
    ...savedSource,
    id: "source-two",
  };
  let reconcileInput: ReadonlyMap<string, readonly string[]> | undefined;
  const handlers = createXSourcesHandlers(sourceDependencies({
    listSources: async () => [savedSource, duplicate],
    listMissions: async () => [{
      id: "mission-one",
      familiarId: "nova",
      sources: [
        { id: "unknown-one", url: "https://x.com/old_handle/status/100" },
        { id: "unknown-two", url: "https://example.com/status/100" },
        { id: "unknown-three", url: "not a URL" },
      ],
    }],
    reconcileAttachments: async (
      _familiarId: string,
      attachments: ReadonlyMap<string, readonly string[]>,
    ) => {
      reconcileInput = attachments;
      return [savedSource, duplicate];
    },
  }));

  const response = await handlers.GET(
    new Request("http://127.0.0.1/api/x/sources?familiarId=nova"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(reconcileInput && [...reconcileInput], []);
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

test("separate Node processes serialize real runner attachments through the familiar lifecycle lock", async () => {
  const root = await mkdtemp(path.join(process.cwd(), ".x-attachment-route-test-"));
  const sourcesDir = path.join(root, "sources");
  const missionsDir = path.join(root, "missions");
  const enteredDir = path.join(root, "entered");
  const overlapPath = path.join(root, "overlap");
  const sentinelPath = path.join(root, "critical-section");
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const routeUrl = pathToFileURL(path.resolve("src/app/api/x/sources/route.ts")).href;
  const sourcesUrl = pathToFileURL(path.resolve("src/lib/server/x-sources.ts")).href;
  const missionStoreUrl = pathToFileURL(
    path.resolve("src/lib/server/research-mission-store.ts"),
  ).href;
  const runnerUrl = pathToFileURL(
    path.resolve("src/lib/server/research-mission-runner.ts"),
  ).href;
  const commonOptions = {
    cwd: process.cwd(),
    env: {
      ...process.env,
      COVEN_X_SOURCES_DIR: sourcesDir,
      COVEN_RESEARCH_MISSIONS_DIR: missionsDir,
    },
    windowsHide: true,
  };
  const setup = `
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const store = await import(${JSON.stringify(missionStoreUrl)});
    const first = await sources.upsertSavedXSource({
      familiarId: "nova",
      postId: "100",
      canonicalUrl: "https://x.com/opencoven/status/100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: "first",
      tags: [],
    });
    const second = await sources.upsertSavedXSource({
      familiarId: "nova",
      postId: "200",
      canonicalUrl: "https://x.com/opencoven/status/200",
      originalUrl: "https://x.com/opencoven/status/200",
      note: "second",
      tags: [],
    });
    const timestamp = "2026-07-31T12:00:00.000Z";
    await store.createResearchMissionWorkspace({
      version: 1,
      id: "mission-one",
      familiarId: "nova",
      title: "Concurrent attachment",
      intent: "Keep both X sources",
      mode: "brief",
      modeSource: "user",
      deliverable: "Brief",
      constraints: [],
      bounds: {
        wallClockMinutes: 10,
        maxIterations: 1,
        sourceTarget: 2,
        checkpointEvery: 1,
        stopWhenCostUnavailable: true,
      },
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      iterations: [],
      artifacts: [],
      sources: [],
    });
    console.log(JSON.stringify([first.source.id, second.source.id]));
  `;
  const worker = `
    const { mkdir, open, rm, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const route = await import(${JSON.stringify(routeUrl)});
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const store = await import(${JSON.stringify(missionStoreUrl)});
    const runnerModule = await import(${JSON.stringify(runnerUrl)});
    const body = JSON.parse(process.env.CAVE_TEST_BODY);
    const startAt = Number(process.env.CAVE_TEST_START_AT);
    const wait = Math.max(0, startAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const handler = route.createXSourcesHandlers({
      rejectNonLocalRequest: () => null,
      readJsonBody: async () => ({ ok: true, body }),
      sweepExpiredCache: async () => 0,
      requireResearch: async () => {},
      listSources: sources.listSavedXSources,
      loadMission: store.loadResearchMission,
      makeRunner: () => {
        const runner = runnerModule.makeProductionResearchMissionRunner();
        return { act: (id, input) => runner.act(id, input) };
      },
      withLifecycleLock: (familiarId, operation) => (
        sources.withXSourceLifecycleLock(familiarId, async () => {
          await mkdir(process.env.CAVE_TEST_ENTERED_DIR, { recursive: true });
          await writeFile(
            path.join(process.env.CAVE_TEST_ENTERED_DIR, body.sourceId),
            "entered",
            "utf8",
          );
          let sentinel;
          try {
            sentinel = await open(process.env.CAVE_TEST_SENTINEL_PATH, "wx");
          } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            await writeFile(process.env.CAVE_TEST_OVERLAP_PATH, "overlap", "utf8");
          }
          try {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return await operation();
          } finally {
            if (sentinel) {
              await sentinel.close();
              await rm(process.env.CAVE_TEST_SENTINEL_PATH, { force: true });
            }
          }
        })
      ),
      setMissionAttached: sources.setXSourceMissionAttached,
      errorResponse: (error) => Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      }, { status: 500 }),
    });
    const response = await handler.POST(new Request("http://127.0.0.1/api/x/sources", {
      method: "POST",
    }));
    if (!response.ok) throw new Error(JSON.stringify(await response.json()));
  `;
  const verify = `
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const store = await import(${JSON.stringify(missionStoreUrl)});
    const mission = await store.loadResearchMission("mission-one");
    const saved = await sources.listSavedXSources("nova");
    console.log(JSON.stringify({ mission, saved }));
  `;

  try {
    const setupResult = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", setup,
      ],
      commonOptions,
    );
    const sourceIds = JSON.parse(setupResult.stdout.trim()) as string[];
    const startAt = Date.now() + 1_000;
    await Promise.all(sourceIds.map((sourceId) => execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", worker,
      ],
      {
        ...commonOptions,
        env: {
          ...commonOptions.env,
          CAVE_TEST_BODY: JSON.stringify({
            action: "attach",
            familiarId: "nova",
            sourceId,
            missionId: "mission-one",
          }),
          CAVE_TEST_START_AT: String(startAt),
          CAVE_TEST_ENTERED_DIR: enteredDir,
          CAVE_TEST_OVERLAP_PATH: overlapPath,
          CAVE_TEST_SENTINEL_PATH: sentinelPath,
        },
      },
    )));
    assert.deepEqual((await readdir(enteredDir)).sort(), [...sourceIds].sort());
    await assert.rejects(() => readFile(overlapPath, "utf8"), /ENOENT/);

    const verified = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", verify,
      ],
      commonOptions,
    );
    const result = JSON.parse(verified.stdout.trim()) as {
      mission: { sources: Array<{ id: string }> };
      saved: Array<{ id: string; attachedMissionIds: string[] }>;
    };
    assert.deepEqual(
      result.mission.sources.map((source) => source.id).sort(),
      [...sourceIds].sort(),
    );
    for (const sourceId of sourceIds) {
      assert.deepEqual(
        result.saved.find((source) => source.id === sourceId)?.attachedMissionIds,
        ["mission-one"],
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate Node processes linearize attach before DELETE without a false attach failure", async () => {
  const root = await mkdtemp(path.join(process.cwd(), ".x-attach-delete-route-test-"));
  const sourcesDir = path.join(root, "sources");
  const runnerEnteredPath = path.join(root, "runner-entered");
  const missionMutationPath = path.join(root, "mission-source");
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const routeUrl = pathToFileURL(path.resolve("src/app/api/x/sources/route.ts")).href;
  const sourcesUrl = pathToFileURL(path.resolve("src/lib/server/x-sources.ts")).href;
  const commonOptions = {
    cwd: process.cwd(),
    env: {
      ...process.env,
      COVEN_X_SOURCES_DIR: sourcesDir,
    },
    windowsHide: true,
  };
  const setup = `
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const saved = await sources.upsertSavedXSource({
      familiarId: "nova",
      postId: "100",
      canonicalUrl: "https://x.com/opencoven/status/100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: "",
      tags: [],
    });
    console.log(saved.source.id);
  `;
  const attach = `
    const { writeFile } = await import("node:fs/promises");
    const route = await import(${JSON.stringify(routeUrl)});
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const sourceId = process.env.CAVE_SOURCE_ID;
    const handler = route.createXSourcesHandlers({
      rejectNonLocalRequest: () => null,
      readJsonBody: async () => ({
        ok: true,
        body: {
          action: "attach",
          familiarId: "nova",
          sourceId,
          missionId: "mission-one",
        },
      }),
      sweepExpiredCache: async () => 0,
      requireResearch: async () => {},
      listSources: sources.listSavedXSources,
      loadMission: async () => ({
        id: "mission-one",
        familiarId: "nova",
        sources: [],
      }),
      makeRunner: () => ({
        act: async () => {
          await writeFile(process.env.CAVE_RUNNER_ENTERED_PATH, "entered", "utf8");
          await new Promise((resolve) => setTimeout(resolve, 200));
          await writeFile(process.env.CAVE_MISSION_MUTATION_PATH, sourceId, "utf8");
          return { id: "mission-one" };
        },
      }),
      withLifecycleLock: sources.withXSourceLifecycleLock,
      setMissionAttached: sources.setXSourceMissionAttached,
      errorResponse: (error) => Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      }, { status: 500 }),
    });
    const response = await handler.POST(new Request("http://127.0.0.1/api/x/sources", {
      method: "POST",
    }));
    console.log(JSON.stringify({ status: response.status, body: await response.json() }));
  `;
  const remove = `
    const route = await import(${JSON.stringify(routeUrl)});
    const sources = await import(${JSON.stringify(sourcesUrl)});
    const handler = route.createXSourcesHandlers({
      rejectNonLocalRequest: () => null,
      readJsonBody: async () => ({
        ok: true,
        body: {
          familiarId: "nova",
          sourceId: process.env.CAVE_SOURCE_ID,
        },
      }),
      sweepExpiredCache: async () => 0,
      requireResearch: async () => {},
      removeSource: sources.removeSavedXSource,
      withLifecycleLock: sources.withXSourceLifecycleLock,
      errorResponse: (error) => Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      }, { status: 500 }),
    });
    const response = await handler.DELETE(new Request("http://127.0.0.1/api/x/sources", {
      method: "DELETE",
    }));
    console.log(JSON.stringify({ status: response.status, body: await response.json() }));
  `;
  const verify = `
    const sources = await import(${JSON.stringify(sourcesUrl)});
    console.log(JSON.stringify(await sources.listSavedXSources("nova")));
  `;

  try {
    const setupResult = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", setup,
      ],
      commonOptions,
    );
    const sourceId = setupResult.stdout.trim();
    const attachResult = execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", attach,
      ],
      {
        ...commonOptions,
        env: {
          ...commonOptions.env,
          CAVE_SOURCE_ID: sourceId,
          CAVE_RUNNER_ENTERED_PATH: runnerEnteredPath,
          CAVE_MISSION_MUTATION_PATH: missionMutationPath,
        },
      },
    );
    await waitForFile(runnerEnteredPath);
    const removeResult = execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", remove,
      ],
      {
        ...commonOptions,
        env: {
          ...commonOptions.env,
          CAVE_SOURCE_ID: sourceId,
        },
      },
    );
    const [attached, removed] = await Promise.all([attachResult, removeResult]);
    assert.equal(JSON.parse(attached.stdout.trim()).status, 200);
    assert.equal(JSON.parse(removed.stdout.trim()).status, 200);
    assert.equal(await readFile(missionMutationPath, "utf8"), sourceId);

    const verified = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", verify,
      ],
      commonOptions,
    );
    assert.deepEqual(JSON.parse(verified.stdout.trim()), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

console.log("research-routes.test.ts: ok");
