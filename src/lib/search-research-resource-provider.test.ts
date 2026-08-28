import assert from "node:assert/strict";
import test from "node:test";

import type { ResourceManifestV1, ResourceQueryResponseV1 } from "./research-resource-contracts.ts";
import { createResearchResourceSearchProvider } from "./search-research-resource-provider.ts";

const manifest: ResourceManifestV1 = {
  version: 1,
  id: "resource_a",
  revision: 3,
  kind: "local-file",
  canonicalIdentity: "resource:a",
  title: "Verified notes",
  sourceType: "local-file",
  subject: { projectId: "project_a" },
  sensitivity: "private",
  ingest: { desired: true, state: "ready" },
  currentSnapshotId: "snapshot_a",
  createdAt: "2026-08-27T12:00:00.000Z",
  updatedAt: "2026-08-27T13:00:00.000Z",
};

const response: ResourceQueryResponseV1 = {
  version: 1,
  ranking: "hybrid",
  hits: [{
    resourceId: "resource_a",
    snapshotId: "snapshot_a",
    resourceRevision: 3,
    normalizedBlobDigest: "a".repeat(64),
    selector: { type: "text-span", start: 0, end: 17 },
    excerpt: "verified evidence",
    excerptDigest: "b".repeat(64),
    retrieval: {
      exact: false,
      lexical: { matched: true, rank: 1 },
      semantic: { state: "unavailable", matched: false },
    },
  }],
};

const query = {
  text: "verified",
  phrases: [],
  filters: [],
  projectIds: ["project_a"],
  familiarIds: [],
  entityTypes: ["resource"],
  limit: 10,
};

test("Research provider emits permission-scoped documents from authoritative hits", async () => {
  let retrievalInput: unknown;
  const provider = createResearchResourceSearchProvider({
    retrieval: { query: async (input) => { retrievalInput = input; return response; } },
    listManifests: async () => [manifest],
  });
  const allowed = await provider.query!(query, {
    allowedProjectIds: ["project_a"],
    allowedProjectRoots: null,
    familiarId: null,
  });
  assert.equal(allowed.documents.length, 1);
  assert.equal(allowed.documents[0]?.entityType, "resource");
  assert.equal(allowed.documents[0]?.projectRoot, null);
  assert.equal(allowed.documents[0]?.body, "verified evidence");
  assert.deepEqual((retrievalInput as { filters: unknown }).filters, { projectIds: ["project_a"] });

  const denied = await provider.query!(query, {
    allowedProjectIds: ["project_b"],
    allowedProjectRoots: null,
    familiarId: null,
  });
  assert.deepEqual(denied.documents, []);
  assert.equal(await provider.fingerprint(), await provider.fingerprint(), "fingerprint is deterministic");
});

test("Research provider returns one safe diagnostic on retrieval failure", async () => {
  const provider = createResearchResourceSearchProvider({
    retrieval: { query: async () => { throw new Error("/private/research/index"); } },
    listManifests: async () => [manifest],
  });
  const result = await provider.query!(query, {
    allowedProjectIds: null,
    allowedProjectRoots: null,
    familiarId: null,
  });
  assert.equal(result.documents.length, 0);
  assert.equal(JSON.stringify(result.diagnostics).includes("/private"), false);
});
