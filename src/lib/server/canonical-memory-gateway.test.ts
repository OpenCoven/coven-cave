// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CanonicalMemoryGatewayError,
  canonicalMemoryDetail,
  canonicalMemoryList,
  canonicalMemoryListResponse,
  canonicalMemoryOverview,
  createFamiliarCanonicalMemoryCache,
  invalidateCachedCanonicalMemorySummariesForTest,
  loadCachedCanonicalMemorySummariesForFamiliar,
} from "./canonical-memory-gateway.ts";

const MEMORY_ID = "11111111-1111-5111-8111-111111111111";
const OTHER_MEMORY_ID = "22222222-2222-5222-8222-222222222222";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FALLBACK_SOURCE = { kind: "coven-origin", label: "Coven origin" };

const currentListEntry = {
  id: MEMORY_ID,
  familiar_id: "fixture-familiar",
  title: "fixture-note",
  path: "fixture-familiar/fixture-note.md",
  updated_at: "4m ago",
  updated_at_iso: "2026-07-26T09:56:00Z",
  excerpt: "Synthetic summary.",
  source: { kind: "coven-origin", label: "Coven origin" },
  privacy_classification: null,
  reveal_required: null,
  verification_state: "needs_review",
};

const currentOverview = {
  generated_at: "2026-07-26T10:00:00Z",
  totals: {
    entries: 2,
    familiars: 1,
    verified: 1,
    needs_review: 1,
    unknown: 0,
  },
  last_updated_at: "2026-07-26T09:56:00Z",
  capabilities: {
    detail: true,
    verification: true,
    attestation_metadata: true,
    supersession_history: true,
    mutations: false,
  },
  verification: {
    state: "needs_review",
    checked_at: "2026-07-26T10:00:00Z",
    manifest: "manifest-v1",
    index: null,
    issues: ["one entry needs review"],
  },
};

const currentDetail = {
  id: MEMORY_ID,
  familiar_id: "fixture-familiar",
  title: "fixture-note",
  updated_at: "2026-07-26T09:56:00Z",
  source: { kind: "coven-origin", label: "Coven origin" },
  content: "Synthetic detail.",
  content_format: "markdown",
  privacy: {
    classification: null,
    reveal_required: null,
    reason: "privacy taxonomy unavailable",
  },
  verification: {
    state: "needs_review",
    reason: "one entry needs review",
  },
  attestation: {
    proof: { kind: "synthetic-proof" },
    witnesses: ["fixture-witness"],
  },
  supersession: {
    supersedes: null,
    superseded_by: OTHER_MEMORY_ID,
  },
};

function summaryFixture(id: string, familiarId: string) {
  return {
    id,
    familiarId,
    title: `memory-${id}`,
    updatedAt: "2026-07-26T09:56:00Z",
    relativeUpdatedAt: "4m ago",
    excerpt: `Summary ${id}`,
    source: FALLBACK_SOURCE,
    privacy: { classification: null, revealRequired: null },
    verification: { state: "verified" as const },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function response(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    data,
    ...overrides,
  };
}

function dependencies(
  result: ReturnType<typeof response>,
  options: {
    selectedMode?: "local" | "hub" | "unconfigured-hub";
    localSocketPath?: string;
    events?: string[];
  } = {},
) {
  const events = options.events ?? [];
  const calls: Array<{ target: unknown; request: unknown }> = [];
  const selectedMode = options.selectedMode ?? "local";
  const localSocketPath = options.localSocketPath ?? "/secret/local.sock";
  const deps = {
    loadConfig: async () => {
      events.push("loadConfig");
      return {
        multiHost:
          selectedMode === "local"
            ? { mode: "local", hubUrl: "", executorUrls: [] }
            : { mode: "hub", hubUrl: "https://hub.example", executorUrls: [] },
      };
    },
    selectedTarget: () => {
      events.push("selectedTarget");
      if (selectedMode === "hub") {
        return {
          mode: "hub",
          label: "Server hub",
          url: "https://hub.example",
        };
      }
      if (selectedMode === "unconfigured-hub") {
        return {
          mode: "unconfigured-hub",
          label: "Server hub",
          error: "secret upstream hub configuration",
        };
      }
      return {
        mode: "local",
        label: "Local daemon",
        socketPath: "/secret/selected.sock",
      };
    },
    localTarget: () => {
      events.push("localTarget");
      return {
        mode: "local",
        label: "Local daemon",
        socketPath: localSocketPath,
      };
    },
    call: async (target: unknown, request: unknown) => {
      events.push("call");
      calls.push({ target, request });
      return result;
    },
  };
  return { deps, calls, events };
}

async function expectGatewayError(
  action: () => Promise<unknown>,
  code: string,
  status: number,
) {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof CanonicalMemoryGatewayError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
  assert.equal(caught.message, code);
  return caught;
}

test("normalizes the current list contract without serializing daemon paths", async () => {
  const { deps } = dependencies(response([currentListEntry]));

  const entries = await canonicalMemoryList(deps);

  assert.deepEqual(entries, [
    {
      id: MEMORY_ID,
      familiarId: "fixture-familiar",
      title: "fixture-note",
      updatedAt: "2026-07-26T09:56:00Z",
      relativeUpdatedAt: "4m ago",
      excerpt: "Synthetic summary.",
      source: FALLBACK_SOURCE,
      privacy: {
        classification: null,
        revealRequired: null,
      },
      verification: {
        state: "needs-review",
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /"path"/);
  assert.doesNotMatch(
    JSON.stringify(entries),
    /fixture-familiar\/fixture-note\.md/,
  );
});

test("uses the exact Coven-origin fallback when a current list row omits source", async () => {
  const entry = clone(currentListEntry);
  delete entry.source;
  const { deps } = dependencies(response([entry]));

  const entries = await canonicalMemoryList(deps);

  assert.deepEqual(entries[0].source, FALLBACK_SOURCE);
});

test("normalizes current overview fields and needs_review", async () => {
  const { deps } = dependencies(response(currentOverview));

  const overview = await canonicalMemoryOverview(deps);

  assert.deepEqual(overview, {
    generatedAt: "2026-07-26T10:00:00Z",
    totals: {
      entries: 2,
      familiars: 1,
      verified: 1,
      needsReview: 1,
      unknown: 0,
    },
    lastUpdatedAt: "2026-07-26T09:56:00Z",
    capabilities: {
      detail: true,
      verification: true,
      attestationMetadata: true,
      supersessionHistory: true,
      mutations: false,
    },
    verification: {
      state: "needs-review",
      checkedAt: "2026-07-26T10:00:00Z",
      manifest: "manifest-v1",
      index: null,
      issues: ["one entry needs review"],
    },
  });
});

test("normalizes current detail and reduces raw attestation to a field count", async () => {
  const { deps } = dependencies(response(currentDetail));

  const detail = await canonicalMemoryDetail(MEMORY_ID, deps);

  assert.deepEqual(detail, {
    id: MEMORY_ID,
    familiarId: "fixture-familiar",
    title: "fixture-note",
    updatedAt: "2026-07-26T09:56:00Z",
    source: FALLBACK_SOURCE,
    content: "Synthetic detail.",
    contentFormat: "markdown",
    privacy: {
      classification: null,
      revealRequired: null,
      reason: "privacy taxonomy unavailable",
    },
    verification: {
      state: "needs-review",
      reason: "one entry needs review",
    },
    attestationMetadata: { fieldCount: 2 },
    supersession: {
      supersedes: null,
      supersededBy: OTHER_MEMORY_ID,
    },
  });
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(
    serialized,
    /proof|synthetic-proof|witnesses|fixture-witness|path|socket/,
  );
});

test("maps a null detail attestation to null metadata", async () => {
  const detail = clone(currentDetail);
  detail.attestation = null;
  const { deps } = dependencies(response(detail));

  const normalized = await canonicalMemoryDetail(MEMORY_ID, deps);

  assert.equal(normalized.attestationMetadata, null);
});

test("familiar-scoped cache rejects a warmed local scope after selection switches to hub mode", async () => {
  let calls = 0;
  const cache = createFamiliarCanonicalMemoryCache({
    loadList: async () => {
      calls += 1;
      return [summaryFixture("memory-1", "sage")];
    },
  });
  const local = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-a.sock",
  });
  const hub = dependencies(response([currentListEntry]), {
    selectedMode: "hub",
    localSocketPath: "/secret/target-a.sock",
  });

  assert.deepEqual(await cache.load("sage", local.deps), [
    summaryFixture("memory-1", "sage"),
  ]);
  assert.equal(calls, 1);

  await expectGatewayError(
    () => cache.load("sage", hub.deps),
    "local_daemon_required",
    409,
  );
  assert.equal(calls, 1);
});

test("familiar-scoped cache shares one full-list fetch across same-target concurrent and repeated reads within ttl", async () => {
  let calls = 0;
  let resolveList:
    | ((entries: Array<ReturnType<typeof summaryFixture>>) => void)
    | null = null;
  const cache = createFamiliarCanonicalMemoryCache({
    now: () => 0,
    loadList: () =>
      new Promise((resolve) => {
        calls += 1;
        resolveList = resolve;
      }),
  });
  const firstDeps = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/shared.sock",
  });
  const secondDeps = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/shared.sock",
  });

  const sagePromise = cache.load("sage", firstDeps.deps);
  const mossPromise = cache.load("moss", secondDeps.deps);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);

  resolveList?.([
    summaryFixture("memory-1", "sage"),
    summaryFixture("memory-2", "moss"),
    summaryFixture("memory-3", "sage"),
  ]);

  assert.deepEqual(await sagePromise, [
    summaryFixture("memory-1", "sage"),
    summaryFixture("memory-3", "sage"),
  ]);
  assert.deepEqual(await mossPromise, [summaryFixture("memory-2", "moss")]);
  assert.deepEqual(await cache.load("sage", secondDeps.deps), [
    summaryFixture("memory-1", "sage"),
    summaryFixture("memory-3", "sage"),
  ]);
  assert.deepEqual(await cache.load("unknown", firstDeps.deps), []);
  assert.equal(calls, 1);
});

test("familiar-scoped cache refetches when the local target changes", async () => {
  let calls = 0;
  const cache = createFamiliarCanonicalMemoryCache({
    loadList: async (deps) => {
      calls += 1;
      const socketPath = deps?.localTarget().socketPath;
      return [
        summaryFixture(
          socketPath === "/secret/target-a.sock" ? "memory-a" : "memory-b",
          "sage",
        ),
      ];
    },
  });
  const targetA = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-a.sock",
  });
  const targetB = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-b.sock",
  });

  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-a", "sage"),
  ]);
  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-a", "sage"),
  ]);
  assert.equal(calls, 1);

  assert.deepEqual(await cache.load("sage", targetB.deps), [
    summaryFixture("memory-b", "sage"),
  ]);
  assert.equal(calls, 2);
});

test("familiar-scoped cache isolates concurrent in-flight work for different local targets", async () => {
  let calls = 0;
  let resolveA:
    | ((entries: Array<ReturnType<typeof summaryFixture>>) => void)
    | null = null;
  let resolveB:
    | ((entries: Array<ReturnType<typeof summaryFixture>>) => void)
    | null = null;
  const cache = createFamiliarCanonicalMemoryCache({
    loadList: (deps) =>
      new Promise((resolve) => {
        calls += 1;
        const socketPath = deps?.localTarget().socketPath;
        if (socketPath === "/secret/target-a.sock") {
          resolveA = resolve;
          return;
        }
        resolveB = resolve;
      }),
  });
  const targetA = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-a.sock",
  });
  const targetB = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-b.sock",
  });

  const promiseA = cache.load("sage", targetA.deps);
  const promiseB = cache.load("sage", targetB.deps);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);

  resolveB?.([summaryFixture("memory-b", "sage")]);
  assert.deepEqual(await promiseB, [summaryFixture("memory-b", "sage")]);

  resolveA?.([summaryFixture("memory-a", "sage")]);
  assert.deepEqual(await promiseA, [summaryFixture("memory-a", "sage")]);
});

test("familiar-scoped cache refetches after ttl expiry and invalidation across all scopes", async () => {
  let now = 0;
  let calls = 0;
  const perTargetCalls = new Map<string, number>();
  const cache = createFamiliarCanonicalMemoryCache({
    now: () => now,
    loadList: async (deps) => {
      calls += 1;
      const socketPath = deps?.localTarget().socketPath ?? "/missing";
      const nextCall = (perTargetCalls.get(socketPath) ?? 0) + 1;
      perTargetCalls.set(socketPath, nextCall);
      return [summaryFixture(`memory-${socketPath}-${nextCall}`, "sage")];
    },
  });
  const targetA = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-a.sock",
  });
  const targetB = dependencies(response([currentListEntry]), {
    localSocketPath: "/secret/target-b.sock",
  });

  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-/secret/target-a.sock-1", "sage"),
  ]);
  assert.deepEqual(await cache.load("sage", targetB.deps), [
    summaryFixture("memory-/secret/target-b.sock-1", "sage"),
  ]);
  now = 59_999;
  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-/secret/target-a.sock-1", "sage"),
  ]);
  assert.deepEqual(await cache.load("sage", targetB.deps), [
    summaryFixture("memory-/secret/target-b.sock-1", "sage"),
  ]);
  assert.equal(calls, 2);

  now = 60_000;
  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-/secret/target-a.sock-2", "sage"),
  ]);
  assert.deepEqual(await cache.load("sage", targetB.deps), [
    summaryFixture("memory-/secret/target-b.sock-2", "sage"),
  ]);
  assert.equal(calls, 4);

  cache.invalidate();
  assert.deepEqual(await cache.load("sage", targetA.deps), [
    summaryFixture("memory-/secret/target-a.sock-3", "sage"),
  ]);
  assert.deepEqual(await cache.load("sage", targetB.deps), [
    summaryFixture("memory-/secret/target-b.sock-3", "sage"),
  ]);
  assert.equal(calls, 6);
});

test("familiar-scoped cache does not cache failures as success", async () => {
  let calls = 0;
  const cache = createFamiliarCanonicalMemoryCache({
    loadList: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("temporary failure");
      }
      return [summaryFixture("memory-1", "sage")];
    },
  });

  await assert.rejects(cache.load("sage"), /temporary failure/);
  assert.equal(calls, 1);

  assert.deepEqual(await cache.load("sage"), [summaryFixture("memory-1", "sage")]);
  assert.equal(calls, 2);
  assert.deepEqual(await cache.load("sage"), [summaryFixture("memory-1", "sage")]);
  assert.equal(calls, 2);
});

test("canonicalMemoryListResponse immediately primes a warmed dashboard cache with fresh entries", async () => {
  invalidateCachedCanonicalMemorySummariesForTest();
  const target = "/secret/prime.sock";
  const warmedDeps = dependencies(
    response([
      { ...clone(currentListEntry), familiar_id: "sage", id: MEMORY_ID, title: "Warm", excerpt: "Warm entry." },
    ]),
    { localSocketPath: target },
  );
  const freshDeps = dependencies(
    response([
      { ...clone(currentListEntry), familiar_id: "sage", id: OTHER_MEMORY_ID, title: "Fresh", excerpt: "Fresh entry." },
    ]),
    { localSocketPath: target },
  );
  const readDeps = dependencies(response([]), { localSocketPath: target });

  assert.deepEqual(
    await loadCachedCanonicalMemorySummariesForFamiliar("sage", warmedDeps.deps),
    [
      {
        id: MEMORY_ID,
        familiarId: "sage",
        title: "Warm",
        updatedAt: "2026-07-26T09:56:00Z",
        relativeUpdatedAt: "4m ago",
        excerpt: "Warm entry.",
        source: FALLBACK_SOURCE,
        privacy: { classification: null, revealRequired: null },
        verification: { state: "needs-review" },
      },
    ],
  );

  const responseValue = await canonicalMemoryListResponse(freshDeps.deps);
  assert.equal(responseValue.status, 200);

  assert.deepEqual(
    await loadCachedCanonicalMemorySummariesForFamiliar("sage", readDeps.deps),
    [
      {
        id: OTHER_MEMORY_ID,
        familiarId: "sage",
        title: "Fresh",
        updatedAt: "2026-07-26T09:56:00Z",
        relativeUpdatedAt: "4m ago",
        excerpt: "Fresh entry.",
        source: FALLBACK_SOURCE,
        privacy: { classification: null, revealRequired: null },
        verification: { state: "needs-review" },
      },
    ],
  );
});

test("canonicalMemoryListResponse does not overwrite the last valid cache entry on failure", async () => {
  invalidateCachedCanonicalMemorySummariesForTest();
  const target = "/secret/failure.sock";
  const warmedDeps = dependencies(
    response([
      { ...clone(currentListEntry), familiar_id: "sage", id: MEMORY_ID, title: "Warm", excerpt: "Warm entry." },
    ]),
    { localSocketPath: target },
  );
  const failedDeps = dependencies(
    { ok: false, status: 503, error: "daemon token=/secret" },
    { localSocketPath: target },
  );
  const readDeps = dependencies(response([]), { localSocketPath: target });

  await loadCachedCanonicalMemorySummariesForFamiliar("sage", warmedDeps.deps);
  const responseValue = await canonicalMemoryListResponse(failedDeps.deps);
  assert.equal(responseValue.status, 503);
  assert.deepEqual(await responseValue.json(), {
    ok: false,
    code: "canonical_memory_unavailable",
  });

  assert.deepEqual(
    await loadCachedCanonicalMemorySummariesForFamiliar("sage", readDeps.deps),
    [
      {
        id: MEMORY_ID,
        familiarId: "sage",
        title: "Warm",
        updatedAt: "2026-07-26T09:56:00Z",
        relativeUpdatedAt: "4m ago",
        excerpt: "Warm entry.",
        source: FALLBACK_SOURCE,
        privacy: { classification: null, revealRequired: null },
        verification: { state: "needs-review" },
      },
    ],
  );
});

test("canonicalMemoryListResponse primes only the validated target scope", async () => {
  invalidateCachedCanonicalMemorySummariesForTest();
  const targetA = "/secret/target-a.sock";
  const targetB = "/secret/target-b.sock";
  const warmA = dependencies(
    response([
      { ...clone(currentListEntry), familiar_id: "sage", id: MEMORY_ID, title: "A-warm", excerpt: "Warm A." },
    ]),
    { localSocketPath: targetA },
  );
  const warmB = dependencies(
    response([
      { ...clone(currentListEntry), familiar_id: "sage", id: OTHER_MEMORY_ID, title: "B-warm", excerpt: "Warm B." },
    ]),
    { localSocketPath: targetB },
  );
  const primeA = dependencies(
    response([
      {
        ...clone(currentListEntry),
        familiar_id: "sage",
        id: "33333333-3333-5333-8333-333333333333",
        title: "A-fresh",
        excerpt: "Fresh A.",
      },
    ]),
    { localSocketPath: targetA },
  );

  await loadCachedCanonicalMemorySummariesForFamiliar("sage", warmA.deps);
  await loadCachedCanonicalMemorySummariesForFamiliar("sage", warmB.deps);
  await canonicalMemoryListResponse(primeA.deps);

  assert.deepEqual(
    await loadCachedCanonicalMemorySummariesForFamiliar("sage", dependencies(response([]), { localSocketPath: targetA }).deps),
    [
      {
        id: "33333333-3333-5333-8333-333333333333",
        familiarId: "sage",
        title: "A-fresh",
        updatedAt: "2026-07-26T09:56:00Z",
        relativeUpdatedAt: "4m ago",
        excerpt: "Fresh A.",
        source: FALLBACK_SOURCE,
        privacy: { classification: null, revealRequired: null },
        verification: { state: "needs-review" },
      },
    ],
  );
  assert.deepEqual(
    await loadCachedCanonicalMemorySummariesForFamiliar("sage", dependencies(response([]), { localSocketPath: targetB }).deps),
    [
      {
        id: OTHER_MEMORY_ID,
        familiarId: "sage",
        title: "B-warm",
        updatedAt: "2026-07-26T09:56:00Z",
        relativeUpdatedAt: "4m ago",
        excerpt: "Warm B.",
        source: FALLBACK_SOURCE,
        privacy: { classification: null, revealRequired: null },
        verification: { state: "needs-review" },
      },
    ],
  );
});

test("rejects missing, extra, mistyped, and malformed list payloads", async () => {
  const missing = clone(currentListEntry);
  delete missing.title;
  const extra = { ...clone(currentListEntry), absolute_path: "/secret/memory.md" };
  const nestedExtra = clone(currentListEntry);
  nestedExtra.source = { ...nestedExtra.source, path: "/secret/source" };
  const mistyped = { ...clone(currentListEntry), reveal_required: "false" };
  const malformedValues = [[missing], [extra], [nestedExtra], [mistyped], null, {}, "not a list"];

  for (const value of malformedValues) {
    const { deps } = dependencies(response(value));
    await expectGatewayError(
      () => canonicalMemoryList(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("rejects non-UUID, non-ISO, unsafe-path, and invalid verification list rows", async () => {
  const invalidRows = [
    { ...clone(currentListEntry), id: "not-a-uuid" },
    {
      ...clone(currentListEntry),
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    },
    { ...clone(currentListEntry), updated_at_iso: "yesterday" },
    {
      ...clone(currentListEntry),
      path: "/private-fixture/memory/fixture-note.md",
    },
    { ...clone(currentListEntry), path: "fixture-familiar/../secret.md" },
    {
      ...clone(currentListEntry),
      path: String.raw`fixture-familiar\..\secret.md`,
    },
    { ...clone(currentListEntry), verification_state: "needs-review" },
  ];

  for (const entry of invalidRows) {
    const { deps } = dependencies(response([entry]));
    await expectGatewayError(
      () => canonicalMemoryList(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("rejects oversized list strings and collections", async () => {
  const oversizedEntry = {
    ...clone(currentListEntry),
    excerpt: "x".repeat(MAX_RESPONSE_BYTES + 1),
  };
  const oversizedCollection = Array.from({ length: 10_001 }, () =>
    clone(currentListEntry),
  );

  for (const value of [[oversizedEntry], oversizedCollection]) {
    const { deps } = dependencies(response(value));
    await expectGatewayError(
      () => canonicalMemoryList(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("rejects malformed overview objects and nested extra fields", async () => {
  const missing = clone(currentOverview);
  delete missing.generated_at;
  const extra = { ...clone(currentOverview), path: "/secret/overview" };
  const nestedExtra = clone(currentOverview);
  nestedExtra.totals = { ...nestedExtra.totals, degraded: 0 };
  const mistyped = clone(currentOverview);
  mistyped.capabilities.detail = "true";
  const nonIso = { ...clone(currentOverview), generated_at: "soon" };
  const oversizedIssues = clone(currentOverview);
  oversizedIssues.verification.issues = Array.from(
    { length: 1_001 },
    (_, index) => `issue-${index}`,
  );

  for (const value of [
    missing,
    extra,
    nestedExtra,
    mistyped,
    nonIso,
    oversizedIssues,
    null,
    [],
  ]) {
    const { deps } = dependencies(response(value));
    await expectGatewayError(
      () => canonicalMemoryOverview(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("enforces overview count and last-updated invariants", async () => {
  const invalidOverviews = [
    {
      ...clone(currentOverview),
      totals: { ...currentOverview.totals, entries: -1 },
    },
    {
      ...clone(currentOverview),
      totals: { ...currentOverview.totals, entries: 1.5 },
    },
    {
      ...clone(currentOverview),
      totals: { ...currentOverview.totals, familiars: 3 },
    },
    {
      ...clone(currentOverview),
      totals: { ...currentOverview.totals, verified: 0 },
    },
    {
      ...clone(currentOverview),
      totals: {
        entries: 0,
        familiars: 0,
        verified: 0,
        needs_review: 0,
        unknown: 0,
      },
      last_updated_at: "2026-07-26T09:56:00Z",
    },
    {
      ...clone(currentOverview),
      totals: {
        entries: 1,
        familiars: 1,
        verified: 0,
        needs_review: 0,
        unknown: 1,
      },
      last_updated_at: null,
    },
  ];

  for (const value of invalidOverviews) {
    const { deps } = dependencies(response(value));
    await expectGatewayError(
      () => canonicalMemoryOverview(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("rejects malformed detail fields, mismatched IDs, and oversized attestation", async () => {
  const missing = clone(currentDetail);
  delete missing.content;
  const extra = {
    ...clone(currentDetail),
    path: "fixture-familiar/fixture-note.md",
  };
  const nestedExtra = clone(currentDetail);
  nestedExtra.privacy = { ...nestedExtra.privacy, path: "/secret/privacy" };
  const nonIso = { ...clone(currentDetail), updated_at: "4m ago" };
  const nonUuid = { ...clone(currentDetail), id: "not-a-uuid" };
  const mismatched = { ...clone(currentDetail), id: OTHER_MEMORY_ID };
  const invalidSupersession = clone(currentDetail);
  invalidSupersession.supersession.supersedes = "not-a-uuid";
  const invalidState = clone(currentDetail);
  invalidState.verification.state = "needs-review";
  const scalarAttestation = { ...clone(currentDetail), attestation: "secret" };
  const oversizedAttestation = clone(currentDetail);
  oversizedAttestation.attestation = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`field-${index}`, index]),
  );
  const oversizedAttestationKey = clone(currentDetail);
  oversizedAttestationKey.attestation = {
    ["x".repeat(257)]: "synthetic value",
  };
  const emptyAttestationKey = clone(currentDetail);
  emptyAttestationKey.attestation = { "": "synthetic value" };

  for (const value of [
    missing,
    extra,
    nestedExtra,
    nonIso,
    nonUuid,
    mismatched,
    invalidSupersession,
    invalidState,
    scalarAttestation,
    oversizedAttestation,
    oversizedAttestationKey,
    emptyAttestationKey,
    null,
    [],
  ]) {
    const { deps } = dependencies(response(value));
    await expectGatewayError(
      () => canonicalMemoryDetail(MEMORY_ID, deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("recognizes only the exact legacy list shape as daemon_update_required", async () => {
  const legacy = [
    {
      id: "legacy-fixture-note",
      familiar_id: "fixture-familiar",
      title: "fixture-note",
      path: "fixture-familiar/fixture-note.md",
      updated_at: "4m ago",
      excerpt: "legacy excerpt that must not escape",
      source_context: "legacy context",
    },
  ];
  const { deps } = dependencies(response(legacy));

  const error = await expectGatewayError(
    () => canonicalMemoryList(deps),
    "daemon_update_required",
    426,
  );

  assert.doesNotMatch(
    JSON.stringify(error),
    /legacy excerpt|legacy context|fixture-familiar\/fixture-note|legacy-fixture-note/,
  );

  const withExtra = [{ ...legacy[0], unexpected: true }];
  const extraFixture = dependencies(response(withExtra));
  await expectGatewayError(
    () => canonicalMemoryList(extraFixture.deps),
    "invalid_daemon_payload",
    502,
  );
});

test("maps only overview 404 to daemon_update_required", async () => {
  const upstream = response(
    {
      error: {
        message: "missing /api/v1/memory/overview at /secret/socket",
      },
    },
    { ok: false, status: 404, error: "upstream secret body" },
  );
  const overviewFixture = dependencies(upstream);

  const overviewError = await expectGatewayError(
    () => canonicalMemoryOverview(overviewFixture.deps),
    "daemon_update_required",
    426,
  );
  assert.doesNotMatch(JSON.stringify(overviewError), /secret|socket|overview/);

  const listFixture = dependencies(upstream);
  await expectGatewayError(
    () => canonicalMemoryList(listFixture.deps),
    "canonical_memory_unavailable",
    503,
  );
});

test("maps detail 404 to memory_not_found without leaking the requested ID", async () => {
  const upstream = response(
    {
      error: {
        message: `memory ${MEMORY_ID} was absent at /secret/memory/path`,
      },
    },
    { ok: false, status: 404, error: "upstream body" },
  );
  const { deps } = dependencies(upstream);

  const error = await expectGatewayError(
    () => canonicalMemoryDetail(MEMORY_ID, deps),
    "memory_not_found",
    404,
  );

  assert.doesNotMatch(JSON.stringify(error), new RegExp(MEMORY_ID));
  assert.doesNotMatch(JSON.stringify(error), /secret|memory\/path|upstream body/);
});

test("rejects an invalid detail UUID after selection but before local target or call", async () => {
  for (const invalidId of [
    "../fixture-note.md",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ]) {
    const fixture = dependencies(response(currentDetail));

    await expectGatewayError(
      () => canonicalMemoryDetail(invalidId, fixture.deps),
      "invalid_memory_id",
      400,
    );

    assert.deepEqual(fixture.events, ["loadConfig", "selectedTarget"]);
    assert.equal(fixture.calls.length, 0);
  }
});

test("treats the injected selector as authoritative for local config", async () => {
  let selectedTargetResolutions = 0;
  let localTargetResolutions = 0;
  let transportCalls = 0;
  const deps = {
    loadConfig: async () => ({
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
    }),
    selectedTarget: () => {
      selectedTargetResolutions += 1;
      return {
        mode: "hub",
        label: "Server hub",
        url: "https://hub.example",
      };
    },
    localTarget: () => {
      localTargetResolutions += 1;
      return {
        mode: "local",
        label: "Local daemon",
        socketPath: "/secret/local.sock",
      };
    },
    call: async () => {
      transportCalls += 1;
      return response([currentListEntry]);
    },
  };

  await expectGatewayError(
    () => canonicalMemoryList(deps),
    "local_daemon_required",
    409,
  );

  assert.equal(selectedTargetResolutions, 1);
  assert.equal(localTargetResolutions, 0);
  assert.equal(transportCalls, 0);
});

test("the actual default selector returns only the local policy sentinel", async () => {
  const gatewayModule = await import("./canonical-memory-gateway.ts");
  assert.equal(
    typeof gatewayModule.selectCanonicalMemoryDefaultTargetForTest,
    "function",
  );

  assert.deepEqual(
    gatewayModule.selectCanonicalMemoryDefaultTargetForTest({
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
    }),
    {
      mode: "local",
      label: "Local daemon",
      socketPath: "",
    },
  );
});

test("rejects selected hub and unconfigured-hub before local target or transport", async () => {
  for (const selectedMode of ["hub", "unconfigured-hub"]) {
    const fixture = dependencies(response([currentListEntry]), {
      selectedMode,
    });

    const error = await expectGatewayError(
      () => canonicalMemoryList(fixture.deps),
      "local_daemon_required",
      409,
    );

    assert.deepEqual(fixture.events, ["loadConfig", "selectedTarget"]);
    assert.equal(fixture.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(error), /hub\.example|configuration/);
  }
});

test("uses only fixed allowlisted GET paths with the 4 MiB response cap", async () => {
  const listFixture = dependencies(response([currentListEntry]));
  const overviewFixture = dependencies(response(currentOverview));
  const detailFixture = dependencies(response(currentDetail));

  await canonicalMemoryList(listFixture.deps);
  await canonicalMemoryOverview(overviewFixture.deps);
  await canonicalMemoryDetail(MEMORY_ID, detailFixture.deps);

  assert.deepEqual(
    [
      listFixture.calls[0].request,
      overviewFixture.calls[0].request,
      detailFixture.calls[0].request,
    ],
    [
      {
        method: "GET",
        path: "/api/v1/memory",
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
      {
        method: "GET",
        path: "/api/v1/memory/overview",
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
      {
        method: "GET",
        path: `/api/v1/memory/${MEMORY_ID}`,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
    ],
  );
  for (const fixture of [listFixture, overviewFixture, detailFixture]) {
    assert.deepEqual(fixture.events, [
      "loadConfig",
      "selectedTarget",
      "localTarget",
      "call",
    ]);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].target.mode, "local");
    assert.equal(fixture.calls[0].target.socketPath, "/secret/local.sock");
  }
});

test("maps malformed and oversized safe transport errors to invalid_daemon_payload", async () => {
  for (const safeError of [
    "malformed response",
    "daemon response exceeded size limit",
  ]) {
    const upstream = response(null, {
      ok: false,
      status: 200,
      error: safeError,
    });
    const { deps } = dependencies(upstream);

    await expectGatewayError(
      () => canonicalMemoryList(deps),
      "invalid_daemon_payload",
      502,
    );
  }
});

test("maps other daemon failures and thrown transport errors to a stable safe failure", async () => {
  const unavailable = dependencies(
    response(
      {
        excerpt: "secret excerpt",
        content: "secret content",
        id: MEMORY_ID,
        path: "/private-fixture/memory/fixture-note.md",
        socket: "/private-fixture/coven.sock",
      },
      {
        ok: false,
        status: 503,
        error: "connect reset /private-fixture/coven.sock",
      },
    ),
  );
  const unavailableError = await expectGatewayError(
    () => canonicalMemoryList(unavailable.deps),
    "canonical_memory_unavailable",
    503,
  );
  assert.doesNotMatch(
    JSON.stringify(unavailableError),
    /secret|excerpt|content|11111111|private-fixture|path|socket/,
  );

  const thrown = dependencies(response([currentListEntry]));
  thrown.deps.call = async () => {
    throw new Error(
      `reset while reading ${MEMORY_ID} at /private-fixture/coven.sock`,
    );
  };
  const thrownError = await expectGatewayError(
    () => canonicalMemoryList(thrown.deps),
    "canonical_memory_unavailable",
    503,
  );
  assert.doesNotMatch(
    JSON.stringify(thrownError),
    /11111111|private-fixture|socket|reset/,
  );
});
