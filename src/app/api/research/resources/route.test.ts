import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResourceManifestV1 } from "../../../../lib/research-resource-contracts.ts";
import * as routeModule from "./route.ts";
import { createResearchResourcesRouteHandlers } from "./route.ts";

function localRequest(): Request {
  return new Request("http://localhost:3000/api/research/resources", {
    headers: { host: "localhost" },
  });
}

function manifest(): ResourceManifestV1 {
  return {
    version: 1,
    id: "paper-2401",
    revision: 3,
    kind: "paper",
    canonicalIdentity: "arxiv:2401.00001",
    title: "A paper",
    sourceUri: "https://arxiv.org/abs/2401.00001",
    sourceType: "arxiv",
    category: "paper",
    publishedAt: "2026-08-20T00:00:00Z",
    legacySavedLink: {
      id: "saved-1",
      url: "https://arxiv.org/abs/2401.00001",
      addedAt: "2026-08-21T00:00:00Z",
      source: "desk",
      hiddenLegacyField: "do not expose",
    },
    paper: {
      arxivId: "2401.00001",
      authors: ["Ada Lovelace"],
      abstract: "Abstract",
      publishedAt: "2026-08-20T00:00:00Z",
      hiddenPaperField: "do not expose",
    },
    subject: { familiarId: "familiar-1", hiddenSubjectField: "do not expose" },
    sensitivity: "public",
    ingest: {
      desired: true,
      state: "ready",
      retryable: false,
      hiddenIngestField: "do not expose",
    },
    currentSnapshotId: "snapshot-1",
    createdAt: "2026-08-21T00:00:00Z",
    updatedAt: "2026-08-22T00:00:00Z",
    hiddenTopLevelField: "do not expose",
  };
}

test("the local-only gate runs before feature or catalog access", async () => {
  let enabledReads = 0;
  let catalogReads = 0;
  const route = createResearchResourcesRouteHandlers({
    enabled: () => {
      enabledReads++;
      return true;
    },
    listManifests: async () => {
      catalogReads++;
      return [];
    },
  });

  const response = await route.GET(new Request("https://cave.example.com/api/research/resources", {
    headers: { host: "cave.example.com" },
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "local_request_required",
    error: "forbidden",
  });
  assert.equal(enabledReads, 0);
  assert.equal(catalogReads, 0);
});

test("the default-off gate returns the same bounded 404 as absence", async () => {
  let catalogReads = 0;
  const route = createResearchResourcesRouteHandlers({
    enabled: () => false,
    listManifests: async () => {
      catalogReads++;
      return [];
    },
  });

  const response = await route.GET(localRequest());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "resource_not_found",
    error: "resource not found",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(catalogReads, 0);
});

test("lists only explicitly allowlisted manifest metadata", async () => {
  const route = createResearchResourcesRouteHandlers({
    enabled: () => true,
    listManifests: async () => [manifest()],
  });

  const response = await route.GET(localRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["ok", "resources"]);
  assert.equal(body.resources.length, 1);
  assert.deepEqual(Object.keys(body.resources[0]).sort(), [
    "canonicalIdentity",
    "category",
    "createdAt",
    "currentSnapshotId",
    "id",
    "ingest",
    "kind",
    "legacySavedLink",
    "paper",
    "publishedAt",
    "revision",
    "sensitivity",
    "sourceType",
    "sourceUri",
    "subject",
    "title",
    "updatedAt",
    "version",
  ]);
  assert.deepEqual(Object.keys(body.resources[0].legacySavedLink).sort(), [
    "addedAt", "id", "source", "url",
  ]);
  assert.deepEqual(Object.keys(body.resources[0].paper).sort(), [
    "abstract", "arxivId", "authors", "publishedAt",
  ]);
  assert.deepEqual(Object.keys(body.resources[0].subject), ["familiarId"]);
  assert.deepEqual(Object.keys(body.resources[0].ingest).sort(), [
    "desired", "retryable", "state",
  ]);
  assert.equal(JSON.stringify(body).includes("do not expose"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("catalog failures become one bounded integrity response", async () => {
  const route = createResearchResourcesRouteHandlers({
    enabled: () => true,
    listManifests: async () => {
      throw new Error("/private/catalog/path: malformed record contents");
    },
  });

  const response = await route.GET(localRequest());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "resource_catalog_integrity",
    error: "resource catalog unavailable",
  });
});

test("the route exports no mutation methods", () => {
  assert.equal("POST" in routeModule, false);
  assert.equal("PUT" in routeModule, false);
  assert.equal("PATCH" in routeModule, false);
  assert.equal("DELETE" in routeModule, false);
});
