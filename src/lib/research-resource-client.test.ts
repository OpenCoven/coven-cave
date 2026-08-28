import assert from "node:assert/strict";
import test from "node:test";

import type { ResourceManifestV1 } from "./research-resource-contracts.ts";
import { mutateResearchResource, resourceForQueryHit } from "./research-resource-client.ts";

const manifest = {
  version: 1,
  id: "resource_a",
  revision: 4,
  kind: "local-file",
  canonicalIdentity: "local-file:resource_a",
  title: "Current catalog title",
  sourceType: "local-file",
  subject: {},
  sensitivity: "private",
  ingest: { desired: true, state: "ready" },
  currentSnapshotId: "snapshot_4",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
} satisfies ResourceManifestV1;

test("query evidence only joins catalog metadata from the exact resource revision", () => {
  assert.equal(resourceForQueryHit([manifest], { resourceId: manifest.id, resourceRevision: 4 }), manifest);
  assert.equal(
    resourceForQueryHit([manifest], { resourceId: manifest.id, resourceRevision: 3 }),
    null,
    "a catalog refresh must not lend stale evidence its new title, source, or actions",
  );
});

test("retry and delete convert rejected transport into a settled false result", async () => {
  const rejected: typeof fetch = async () => { throw new Error("connection reset"); };
  assert.equal(await mutateResearchResource("resource_a", "POST", rejected), false);
  assert.equal(await mutateResearchResource("resource_a", "DELETE", rejected), false);
});

test("resource mutation encodes ids and returns the HTTP outcome", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(null, { status: calls.length === 1 ? 200 : 503 });
  };
  assert.equal(await mutateResearchResource("resource a", "POST", request), true);
  assert.equal(await mutateResearchResource("resource a", "DELETE", request), false);
  assert.deepEqual(calls, [
    { url: "/api/research/resources/resource%20a", method: "POST" },
    { url: "/api/research/resources/resource%20a", method: "DELETE" },
  ]);
});
