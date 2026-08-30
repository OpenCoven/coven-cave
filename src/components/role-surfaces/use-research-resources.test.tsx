// @ts-nocheck — react-test-renderer ships no types; this is a hook behavior test.
import assert from "node:assert/strict";

import React from "react";
import { act, create } from "react-test-renderer";
import { test } from "vitest";

import { sha256Digest } from "@/lib/research-protocol/digest";
import { useResearchResources } from "./use-research-resources.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const manifest = {
  version: 1,
  id: "resource_a",
  revision: 2,
  kind: "local-file",
  canonicalIdentity: "local-file:resource_a",
  title: "Field notes",
  sourceType: "local-file",
  subject: {},
  sensitivity: "private",
  ingest: { desired: true, state: "ready" },
  currentSnapshotId: "snapshot_2",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

const hit = {
  resourceId: manifest.id,
  snapshotId: manifest.currentSnapshotId,
  resourceRevision: manifest.revision,
  normalizedBlobDigest: "a".repeat(64),
  selector: { type: "text-span", start: 0, end: 5 },
  excerpt: "alpha",
  excerptDigest: sha256Digest("alpha"),
  retrieval: {
    exact: false,
    lexical: { matched: true, rank: 1 },
    semantic: { state: "unavailable", matched: false },
  },
};

function Probe({ publish }) {
  publish(useResearchResources());
  return null;
}

test("a pending query clears prior evidence and a catalog failure clears stale catalog state", async () => {
  const originalFetch = globalThis.fetch;
  let current;
  let resolvePending;
  let phase = "catalog";
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/research/resources") && phase === "catalog") {
      return Response.json({ ok: true, resources: [manifest] });
    }
    if (phase === "first-search") {
      return Response.json({ ok: true, result: { version: 1, ranking: "hybrid", hits: [hit] } });
    }
    if (phase === "pending-search") {
      return await new Promise((resolve) => { resolvePending = resolve; });
    }
    throw new Error("catalog offline");
  };

  let renderer;
  try {
    await act(async () => {
      renderer = create(<Probe publish={(value) => { current = value; }} />);
    });
    assert.equal(current.available, true);
    assert.equal(current.resources.length, 1);

    phase = "first-search";
    await act(async () => { await current.search("alpha"); });
    assert.equal(current.result.hits.length, 1);

    phase = "pending-search";
    act(() => { void current.search("beta"); });
    assert.equal(current.searching, true);
    assert.equal(current.result, null, "old evidence disappears when the new debounced search begins");

    await act(async () => {
      resolvePending(Response.json({ ok: true, result: { version: 1, ranking: "hybrid", hits: [] } }));
    });

    phase = "first-search";
    await act(async () => { await current.search("alpha"); });
    assert.equal(current.result.hits.length, 1);
    act(() => { current.clearSearch(); });
    assert.equal(current.result, null);
    assert.equal(current.searchError, null);
    assert.equal(current.searching, false);

    phase = "catalog-error";
    await act(async () => { await current.load(); });
    assert.equal(current.available, false);
    assert.deepEqual(current.resources, []);
    assert.equal(current.result, null);
    assert.equal(current.error, "Couldn’t load local resource status.");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch;
  }
});
