// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CanonicalMemoryRequestError,
  fetchCanonicalMemoryDetail,
  fetchCanonicalMemoryList,
  fetchCanonicalMemoryOverview,
} from "./canonical-memory-client.ts";

function summary() {
  return {
    id: "memory-one",
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

function overview() {
  return {
    generatedAt: "2026-07-26T12:00:00.000Z",
    totals: {
      entries: 1,
      familiars: 1,
      verified: 1,
      needsReview: 0,
      unknown: 0,
    },
    lastUpdatedAt: "2026-07-26T12:00:00.000Z",
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

function detail() {
  return {
    id: "memory-one",
    familiarId: "charm",
    title: "Memory one",
    updatedAt: "2026-07-26T12:00:00.000Z",
    source: { kind: "familiar", label: "Charm" },
    content: "Private canonical content.",
    contentFormat: "markdown",
    privacy: {
      classification: "private",
      revealRequired: true,
      reason: "Explicit reveal required.",
    },
    verification: {
      state: "verified",
      reason: "Manifest verified.",
    },
    attestationMetadata: { fieldCount: 2 },
    supersession: {
      supersedes: null,
      supersededBy: null,
    },
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

async function captureError(request) {
  try {
    await request();
    assert.fail("expected canonical memory request to reject");
  } catch (error) {
    return error;
  }
}

test("list and overview use only their no-store endpoints and supplied signals", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const listSignal = new AbortController().signal;
  const overviewSignal = new AbortController().signal;
  globalThis.fetch = async (input, init) => {
    requests.push([input, init]);
    return input === "/api/coven-memory"
      ? response(200, { ok: true, entries: [summary()] })
      : response(200, { ok: true, overview: overview() });
  };
  try {
    assert.deepEqual(await fetchCanonicalMemoryList(listSignal), [summary()]);
    assert.deepEqual(await fetchCanonicalMemoryOverview(overviewSignal), overview());
    assert.deepEqual(requests, [
      ["/api/coven-memory", { cache: "no-store", signal: listSignal }],
      ["/api/coven-memory/overview", { cache: "no-store", signal: overviewSignal }],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("detail treats its id as opaque and URL-encodes the path segment", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const signal = new AbortController().signal;
  globalThis.fetch = async (input, init) => {
    requests.push([input, init]);
    return response(200, { ok: true, entry: detail() });
  };
  try {
    assert.deepEqual(
      await fetchCanonicalMemoryDetail("memory/one?private#fragment", signal),
      detail(),
    );
    assert.deepEqual(requests, [
      [
        "/api/coven-memory/memory%2Fone%3Fprivate%23fragment",
        { cache: "no-store", signal },
      ],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful decoders recursively strip undeclared transport fields", async () => {
  const originalFetch = globalThis.fetch;
  const transportSentinel = "SECRET_CANONICAL_TRANSPORT_SENTINEL";
  const listEntry = {
    ...summary(),
    path: transportSentinel,
    rawContent: transportSentinel,
    source: { ...summary().source, path: transportSentinel },
    privacy: {
      ...summary().privacy,
      rawClassification: transportSentinel,
    },
    verification: {
      ...summary().verification,
      manifestPath: transportSentinel,
    },
  };
  const overviewValue = {
    ...overview(),
    path: transportSentinel,
    rawOverview: transportSentinel,
    totals: { ...overview().totals, rawTotals: transportSentinel },
    capabilities: {
      ...overview().capabilities,
      daemonPath: transportSentinel,
    },
    verification: {
      ...overview().verification,
      rawVerification: transportSentinel,
    },
  };
  const detailValue = {
    ...detail(),
    path: transportSentinel,
    rawContent: transportSentinel,
    source: { ...detail().source, path: transportSentinel },
    privacy: { ...detail().privacy, rawPrivacy: transportSentinel },
    verification: {
      ...detail().verification,
      manifestPath: transportSentinel,
    },
    attestationMetadata: {
      ...detail().attestationMetadata,
      rawAttestation: transportSentinel,
    },
    supersession: {
      ...detail().supersession,
      rawHistory: transportSentinel,
    },
  };
  globalThis.fetch = async (input) => {
    if (input === "/api/coven-memory") {
      return response(200, {
        ok: true,
        entries: [listEntry],
        rawEnvelope: transportSentinel,
      });
    }
    if (input === "/api/coven-memory/overview") {
      return response(200, {
        ok: true,
        overview: overviewValue,
        rawEnvelope: transportSentinel,
      });
    }
    return response(200, {
      ok: true,
      entry: detailValue,
      rawEnvelope: transportSentinel,
    });
  };
  try {
    const decoded = {
      list: await fetchCanonicalMemoryList(),
      overview: await fetchCanonicalMemoryOverview(),
      detail: await fetchCanonicalMemoryDetail("memory-one"),
    };
    assert.deepEqual(decoded, {
      list: [summary()],
      overview: overview(),
      detail: detail(),
    });
    assert.doesNotMatch(
      JSON.stringify(decoded),
      new RegExp(transportSentinel),
    );
    assert.doesNotMatch(
      JSON.stringify(decoded),
      /rawEnvelope|rawContent|rawOverview|rawTotals|daemonPath|manifestPath|rawPrivacy|rawAttestation|rawHistory|"path"/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stable API failures expose only a typed code and status", async () => {
  const originalFetch = globalThis.fetch;
  const privateBody = {
    ok: false,
    code: "local_access_required",
    error: "do not leak this transport message",
    content: "private canonical content",
    path: "/Users/val/.coven/private.md",
  };
  globalThis.fetch = async () => response(403, privateBody);
  try {
    const error = await captureError(() => fetchCanonicalMemoryList());
    assert.ok(error instanceof CanonicalMemoryRequestError);
    assert.deepEqual(
      { name: error.name, code: error.code, status: error.status, message: error.message },
      {
        name: "CanonicalMemoryRequestError",
        code: "local_access_required",
        status: 403,
        message: "local_access_required",
      },
    );
    assert.doesNotMatch(
      error.message,
      /transport message|canonical content|Users|private\.md/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed, non-JSON, and unknown failures become stable private errors", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    async () => response(200, { ok: true, entries: [{ id: "/private/path" }] }),
    async () => response(503, { ok: false, code: "not_a_public_code", error: "secret body" }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("private non-json response body");
      },
    }),
    async () => {
      throw new Error("network failed while reading /Users/val/.coven/private.md");
    },
  ];
  try {
    for (const fetchImpl of cases) {
      globalThis.fetch = fetchImpl;
      const error = await captureError(() => fetchCanonicalMemoryList());
      assert.ok(error instanceof CanonicalMemoryRequestError);
      assert.equal(error.code, "invalid_daemon_payload");
      assert.ok(Number.isInteger(error.status));
      assert.equal(error.message, "invalid_daemon_payload");
      assert.doesNotMatch(error.message, /secret|private|Users|coven/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("each endpoint rejects a wrong successful payload shape", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [request, payload] of [
      [() => fetchCanonicalMemoryList(), { ok: true, entries: "not-an-array" }],
      [() => fetchCanonicalMemoryOverview(), { ok: true, overview: { generatedAt: 4 } }],
      [() => fetchCanonicalMemoryDetail("memory-one"), { ok: true, entry: { content: 5 } }],
      [() => fetchCanonicalMemoryList(), { ok: 1, entries: [summary()] }],
    ]) {
      globalThis.fetch = async () => response(200, payload);
      const error = await captureError(request);
      assert.ok(error instanceof CanonicalMemoryRequestError);
      assert.equal(error.code, "invalid_daemon_payload");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
