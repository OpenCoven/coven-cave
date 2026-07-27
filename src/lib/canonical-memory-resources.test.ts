// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSurfaceWarmCache } from "./surface-warm-cache.ts";
import * as canonicalMemoryResources from "./canonical-memory-resources.ts";
import { CanonicalMemoryRequestError } from "./canonical-memory-client.ts";
import { canonicalMemoryCountsForMilestones } from "./canonical-memory-milestones.ts";
import { deriveRenown } from "./familiar-renown.ts";
import { dueTierMilestones } from "./milestone-defs.ts";

const { installCanonicalMemoryResources } = canonicalMemoryResources;
const createCanonicalMemoryListLoader =
  canonicalMemoryResources.createCanonicalMemoryListLoader ??
  ((readList) => async (force = false) => {
    try {
      const result = await readList(force);
      return { state: "ready", entries: result.data };
    } catch (error) {
      return { state: "error", error };
    }
  });
const createCanonicalMemoryOverviewLoader =
  canonicalMemoryResources.createCanonicalMemoryOverviewLoader ??
  ((readOverview) => async (force = false) => {
    try {
      const result = await readOverview(force);
      return { state: "ready", overview: result.data };
    } catch (error) {
      return { state: "error", error };
    }
  });
const createCanonicalMemoryRefresher =
  canonicalMemoryResources.createCanonicalMemoryRefresher ??
  ((readList, readOverview) => async () => {
    const [list, overviewResult] = await Promise.all([
      readList(true),
      readOverview(true),
    ]);
    return {
      list: { state: "ready", entries: list.data },
      overview: { state: "ready", overview: overviewResult.data },
    };
  });

const LIST_KEY = "canonical-memory:list";
const OVERVIEW_KEY = "canonical-memory:overview";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function summary(id = "memory-one") {
  return {
    id,
    familiarId: "charm",
    title: "Memory one",
    updatedAt: "2026-07-26T12:00:00.000Z",
    relativeUpdatedAt: "today",
    excerpt: "A canonical memory.",
    source: { kind: "familiar", label: "Charm" },
    privacy: { classification: null, revealRequired: null },
    verification: { state: "verified" },
  };
}

function overview(entries = 1) {
  return {
    generatedAt: "2026-07-26T12:00:00.000Z",
    totals: {
      entries,
      familiars: entries === 0 ? 0 : 1,
      verified: entries,
      needsReview: 0,
      unknown: 0,
    },
    lastUpdatedAt: entries === 0 ? null : "2026-07-26T12:00:00.000Z",
    capabilities: {
      detail: true,
      verification: true,
      attestationMetadata: false,
      supersessionHistory: false,
      mutations: false,
    },
    verification: {
      state: "verified",
      checkedAt: "2026-07-26T12:00:00.000Z",
      manifest: null,
      index: null,
      issues: [],
    },
  };
}

function boundListLoader(cache) {
  return createCanonicalMemoryListLoader((force = false) =>
    cache.read(LIST_KEY, { force })
  );
}

function boundOverviewLoader(cache) {
  return createCanonicalMemoryOverviewLoader((force = false) =>
    cache.read(OVERVIEW_KEY, { force })
  );
}

function boundRefresher(cache) {
  return createCanonicalMemoryRefresher(
    (force = false) => cache.read(LIST_KEY, { force }),
    (force = false) => cache.read(OVERVIEW_KEY, { force }),
  );
}

test("exports an injectable canonical list loader", () => {
  assert.equal(
    typeof canonicalMemoryResources.createCanonicalMemoryListLoader,
    "function",
  );
});

test("exports an injectable canonical overview loader", () => {
  assert.equal(
    typeof canonicalMemoryResources.createCanonicalMemoryOverviewLoader,
    "function",
  );
});

test("exports an injectable independently settled canonical refresher", () => {
  assert.equal(
    typeof canonicalMemoryResources.createCanonicalMemoryRefresher,
    "function",
  );
});

test("forced refresh keeps a fresh list ready when overview refresh fails", async () => {
  const listPending = deferred();
  const overviewPending = deferred();
  let listCalls = 0;
  let overviewCalls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: () => {
      listCalls += 1;
      return listPending.promise;
    },
    overview: () => {
      overviewCalls += 1;
      return overviewPending.promise;
    },
  });
  const refresh = boundRefresher(cache);

  const pending = refresh();
  assert.deepEqual(
    { listCalls, overviewCalls },
    { listCalls: 1, overviewCalls: 1 },
    "both forced reads start before either one settles",
  );
  const overviewError = new CanonicalMemoryRequestError(
    "canonical_memory_unavailable",
    503,
  );
  listPending.resolve([summary("fresh-list")]);
  overviewPending.reject(overviewError);

  const result = await pending;
  assert.deepEqual(result.list, {
    state: "ready",
    entries: [summary("fresh-list")],
  });
  assert.equal(result.overview.state, "error");
  assert.strictEqual(result.overview.error, overviewError);
});

test("forced refresh keeps a fresh overview ready when list refresh fails", async () => {
  const listPending = deferred();
  const overviewPending = deferred();
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: () => listPending.promise,
    overview: () => overviewPending.promise,
  });
  const refresh = boundRefresher(cache);

  const pending = refresh();
  const listError = new CanonicalMemoryRequestError(
    "canonical_memory_unavailable",
    503,
  );
  listPending.reject(listError);
  overviewPending.resolve(overview(2));

  const result = await pending;
  assert.equal(result.list.state, "error");
  assert.strictEqual(result.list.error, listError);
  assert.deepEqual(result.overview, {
    state: "ready",
    overview: overview(2),
  });
});

test("simultaneous forced refreshes coalesce list and overview independently", async () => {
  const listPending = deferred();
  const overviewPending = deferred();
  let listCalls = 0;
  let overviewCalls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: () => {
      listCalls += 1;
      return listPending.promise;
    },
    overview: () => {
      overviewCalls += 1;
      return overviewPending.promise;
    },
  });
  const refresh = boundRefresher(cache);

  const first = refresh();
  const second = refresh();
  assert.deepEqual(
    { listCalls, overviewCalls },
    { listCalls: 1, overviewCalls: 1 },
  );
  listPending.resolve([summary("coalesced")]);
  overviewPending.resolve(overview(1));

  const results = await Promise.all([first, second]);
  assert.ok(results.every(({ list }) => list.state === "ready"));
  assert.ok(results.every(({ overview: state }) => state.state === "ready"));
  assert.equal(cache.snapshot().counters.coalesced, 2);
});

test("an expired list waits for the lower revalidated value", async () => {
  let now = 100;
  let calls = 0;
  const revalidation = deferred();
  const cache = createSurfaceWarmCache({ now: () => now });
  installCanonicalMemoryResources(cache, {
    list: () => {
      calls += 1;
      return calls === 1
        ? [summary("stale-one"), summary("stale-two")]
        : revalidation.promise;
    },
    overview: async () => overview(),
  });
  const load = boundListLoader(cache);

  assert.equal((await load()).state, "ready");
  now = 30_101;
  const refreshed = load();
  assert.equal(calls, 2, "the stale read starts one revalidation");
  revalidation.resolve([summary("fresh-lower")]);

  const result = await refreshed;
  assert.equal(result.state, "ready");
  assert.deepEqual(result.entries.map(({ id }) => id), ["fresh-lower"]);
  assert.equal(calls, 2, "joining stale revalidation must not start a third request");
});

test("an expired overview waits for the revalidated value", async () => {
  let now = 100;
  let calls = 0;
  const revalidation = deferred();
  const cache = createSurfaceWarmCache({ now: () => now });
  installCanonicalMemoryResources(cache, {
    list: async () => [],
    overview: () => {
      calls += 1;
      return calls === 1 ? overview(4) : revalidation.promise;
    },
  });
  const load = boundOverviewLoader(cache);

  assert.equal((await load()).state, "ready");
  now = 30_101;
  const refreshed = load();
  assert.equal(calls, 2, "the stale overview starts one revalidation");
  revalidation.resolve(overview(2));

  const result = await refreshed;
  assert.equal(result.state, "ready");
  assert.equal(result.overview.totals.entries, 2);
  assert.equal(calls, 2, "the overview loader joins the in-flight revalidation");
});

test("a failed stale revalidation is unavailable to milestone awards", async () => {
  let now = 100;
  let calls = 0;
  const revalidation = deferred();
  const cache = createSurfaceWarmCache({ now: () => now });
  installCanonicalMemoryResources(cache, {
    list: () => {
      calls += 1;
      return calls === 1
        ? [
            summary("stale-one"),
            summary("stale-two"),
            summary("stale-three"),
            summary("stale-four"),
          ]
        : revalidation.promise;
    },
    overview: async () => overview(),
  });
  const load = boundListLoader(cache);

  assert.equal((await load()).state, "ready");
  now = 30_101;
  const refreshed = load();
  revalidation.reject(new Error("offline"));
  const result = await refreshed;

  assert.equal(result.state, "error", "stale high counts must never become ready");
  const memoryCounts = canonicalMemoryCountsForMilestones(result);
  assert.equal(memoryCounts, null, "failed revalidation has no milestone counts");
  const renown = deriveRenown({
    sessionsTotal: 0,
    memoryCount: memoryCounts?.get("charm") ?? 0,
  });
  const tierAwards =
    memoryCounts === null
      ? []
      : dueTierMilestones(
          [{
            familiarId: "charm",
            displayName: "Charm",
            tierKey: renown.tier.key,
            tierLabel: renown.tier.label,
          }],
          new Set(),
        );
  assert.deepEqual(tierAwards, [], "failed revalidation cannot reach the tier POST path");
});

test("simultaneous stale list consumers join one revalidation", async () => {
  let now = 100;
  let calls = 0;
  const revalidation = deferred();
  const cache = createSurfaceWarmCache({ now: () => now });
  installCanonicalMemoryResources(cache, {
    list: () => {
      calls += 1;
      return calls === 1 ? [summary("stale")] : revalidation.promise;
    },
    overview: async () => overview(),
  });
  const load = boundListLoader(cache);

  await load();
  now = 30_101;
  const first = load();
  const second = load();
  assert.equal(calls, 2);
  revalidation.resolve([summary("fresh")]);

  assert.deepEqual(
    (await Promise.all([first, second])).map((result) =>
      result.state === "ready" ? result.entries[0]?.id : result.state
    ),
    ["fresh", "fresh"],
  );
  assert.equal(calls, 2);
});

test("fresh cached lists do not force a transport request", async () => {
  let calls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: async () => [summary(`memory-${++calls}`)],
    overview: async () => overview(),
  });
  const load = boundListLoader(cache);

  assert.equal((await load()).state, "ready");
  assert.equal((await load()).state, "ready");
  assert.equal(calls, 1);
});

test("installs exactly the list and overview landing resources with a 30 second TTL", () => {
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: async () => [],
    overview: async () => overview(0),
  });

  assert.deepEqual(
    cache.snapshot().entries.map(({ key, ttlMs }) => ({ key, ttlMs })),
    [
      { key: LIST_KEY, ttlMs: 30_000 },
      { key: OVERVIEW_KEY, ttlMs: 30_000 },
    ],
  );
});

test("two simultaneous list reads coalesce to one transport request", async () => {
  const pending = deferred();
  let calls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: () => {
      calls += 1;
      return pending.promise;
    },
    overview: async () => overview(),
  });

  const first = cache.read(LIST_KEY);
  const second = cache.read(LIST_KEY);
  assert.equal(calls, 1);
  pending.resolve([summary()]);
  assert.deepEqual((await first).data, [summary()]);
  assert.deepEqual((await second).data, [summary()]);
  assert.equal(cache.snapshot().counters.coalesced, 1);
});

test("a background warm and direct navigation coalesce", async () => {
  const pending = deferred();
  let calls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: () => {
      calls += 1;
      return pending.promise;
    },
    overview: async () => overview(),
  });

  const warm = cache.warm(LIST_KEY);
  const navigation = cache.read(LIST_KEY);
  assert.equal(calls, 1);
  pending.resolve([summary()]);
  assert.deepEqual((await warm).data, [summary()]);
  assert.deepEqual((await navigation).data, [summary()]);
});

test("a failed request is diagnostic only and the next read retries", async () => {
  let calls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return [summary("fresh")];
    },
    overview: async () => overview(),
  });

  await assert.rejects(cache.read(LIST_KEY), /offline/);
  assert.deepEqual(
    cache.snapshot().entries.find(({ key }) => key === LIST_KEY),
    {
      key: LIST_KEY,
      status: "error",
      hasValue: false,
      loading: false,
      fetchedAt: undefined,
      expiresAt: undefined,
      ttlMs: 30_000,
      error: cache.snapshot().entries.find(({ key }) => key === LIST_KEY)?.error,
      erroredAt: cache.snapshot().entries.find(({ key }) => key === LIST_KEY)?.erroredAt,
    },
  );
  assert.deepEqual((await cache.read(LIST_KEY)).data, [summary("fresh")]);
  assert.equal(calls, 2);
});

test("forced refresh requests both landing resources", async () => {
  let listCalls = 0;
  let overviewCalls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: async () => [summary(`memory-${++listCalls}`)],
    overview: async () => overview(++overviewCalls),
  });

  await Promise.all([cache.read(LIST_KEY), cache.read(OVERVIEW_KEY)]);
  await Promise.all([
    cache.read(LIST_KEY, { force: true }),
    cache.read(OVERVIEW_KEY, { force: true }),
  ]);
  assert.deepEqual({ listCalls, overviewCalls }, { listCalls: 2, overviewCalls: 2 });
});

test("invalidating both resources aborts them and rejects late resolutions", async () => {
  const listPending = deferred();
  const overviewPending = deferred();
  let listSignal;
  let overviewSignal;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: (signal) => {
      listSignal = signal;
      return listPending.promise;
    },
    overview: (signal) => {
      overviewSignal = signal;
      return overviewPending.promise;
    },
  });

  const listWarm = cache.warm(LIST_KEY);
  const overviewWarm = cache.warm(OVERVIEW_KEY);
  cache.invalidate(LIST_KEY);
  cache.invalidate(OVERVIEW_KEY);
  assert.equal(listSignal.aborted, true);
  assert.equal(overviewSignal.aborted, true);

  listPending.resolve([summary("late")]);
  overviewPending.resolve(overview(99));
  await assert.rejects(listWarm, { name: "AbortError" });
  await assert.rejects(overviewWarm, { name: "AbortError" });
  assert.ok(cache.snapshot().entries.every(({ hasValue, status }) => !hasValue && status === "empty"));
});

test("warmup never installs or requests a detail resource", async () => {
  let detailCalls = 0;
  const cache = createSurfaceWarmCache();
  const client = {
    list: async () => [summary()],
    overview: async () => overview(),
    detail: async () => {
      detailCalls += 1;
      throw new Error("detail must stay demand-loaded");
    },
  };
  installCanonicalMemoryResources(cache, client);

  await Promise.all([cache.warm(LIST_KEY), cache.warm(OVERVIEW_KEY)]);
  assert.equal(detailCalls, 0);
  assert.deepEqual(cache.snapshot().entries.map(({ key }) => key), [LIST_KEY, OVERVIEW_KEY]);
});

test("the next read after invalidation requests fresh data", async () => {
  let calls = 0;
  const cache = createSurfaceWarmCache();
  installCanonicalMemoryResources(cache, {
    list: async () => [summary(`memory-${++calls}`)],
    overview: async () => overview(),
  });

  assert.equal((await cache.read(LIST_KEY)).data[0].id, "memory-1");
  cache.invalidate(LIST_KEY);
  assert.equal((await cache.read(LIST_KEY)).data[0].id, "memory-2");
  assert.equal(calls, 2);
});
