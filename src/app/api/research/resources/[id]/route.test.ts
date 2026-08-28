import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResourceManifestV1 } from "../../../../../lib/research-resource-contracts.ts";
import * as routeModule from "./route.ts";
import { createResearchResourceDetailRouteHandlers } from "./route.ts";

function localRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/research/resources/${id}`, {
    headers: { host: "localhost" },
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function manifest(): ResourceManifestV1 {
  return {
    version: 1,
    id: "resource-1",
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: "https://example.com/resource",
    title: "Resource",
    sourceUri: "https://example.com/resource",
    sourceType: "web",
    category: "docs",
    subject: { projectId: "project-1", hiddenSubjectField: "private" },
    sensitivity: "private",
    ingest: { desired: false, state: "metadata_only", hiddenIngestField: "private" },
    createdAt: "2026-08-21T00:00:00Z",
    updatedAt: "2026-08-21T00:00:00Z",
    hiddenTopLevelField: "private",
  };
}

test("the local and disabled gates run before params or catalog access", async () => {
  let paramsReads = 0;
  let catalogReads = 0;
  const route = createResearchResourceDetailRouteHandlers({
    enabled: () => true,
    getManifest: async () => {
      catalogReads++;
      return null;
    },
  });
  const guardedContext = {
    get params(): Promise<{ id: string }> {
      paramsReads++;
      return Promise.resolve({ id: "resource-1" });
    },
  };

  const remote = await route.GET(
    new Request("https://cave.example.com/api/research/resources/resource-1", {
      headers: { host: "cave.example.com" },
    }),
    guardedContext,
  );
  assert.equal(remote.status, 403);
  assert.equal(paramsReads, 0);
  assert.equal(catalogReads, 0);

  const disabledRoute = createResearchResourceDetailRouteHandlers({
    enabled: () => false,
    getManifest: async () => {
      catalogReads++;
      return null;
    },
  });
  const disabled = await disabledRoute.GET(localRequest("resource-1"), guardedContext);
  assert.equal(disabled.status, 404);
  assert.equal(paramsReads, 0);
  assert.equal(catalogReads, 0);
});

test("unsafe ids return 400 before catalog access", async () => {
  const requestedIds: string[] = [];
  const route = createResearchResourceDetailRouteHandlers({
    enabled: () => true,
    getManifest: async (id) => {
      requestedIds.push(id);
      return null;
    },
  });

  for (const id of ["", "../escape", "with%2Fslash", "with space", "nul", "a".repeat(129)]) {
    const response = await route.GET(localRequest("fixture"), context(id));
    assert.equal(response.status, 400, id);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "invalid_resource_id",
      error: "invalid resource id",
    });
  }
  assert.deepEqual(requestedIds, []);
});

test("missing resources return the same bounded 404 as the disabled gate", async () => {
  const route = createResearchResourceDetailRouteHandlers({
    enabled: () => true,
    getManifest: async () => null,
  });

  const response = await route.GET(localRequest("missing"), context("missing"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "resource_not_found",
    error: "resource not found",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("detail returns one strict metadata projection", async () => {
  const route = createResearchResourceDetailRouteHandlers({
    enabled: () => true,
    getManifest: async (id) => id === "resource-1" ? manifest() : null,
  });

  const response = await route.GET(localRequest("resource-1"), context("resource-1"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["ok", "resource"]);
  assert.deepEqual(Object.keys(body.resource).sort(), [
    "canonicalIdentity",
    "category",
    "createdAt",
    "id",
    "ingest",
    "kind",
    "revision",
    "sensitivity",
    "sourceType",
    "sourceUri",
    "subject",
    "title",
    "updatedAt",
    "version",
  ]);
  assert.deepEqual(body.resource.subject, { projectId: "project-1" });
  assert.deepEqual(body.resource.ingest, { desired: false, state: "metadata_only" });
  assert.equal(JSON.stringify(body).includes("private"), true, "reviewed sensitivity remains visible");
  assert.equal(JSON.stringify(body).includes("hidden"), false);
});

test("detail catalog errors are bounded and expose no diagnostics", async () => {
  const route = createResearchResourceDetailRouteHandlers({
    enabled: () => true,
    getManifest: async () => {
      throw new Error("/private/catalog/path: corrupt JSON from resource-1");
    },
  });

  const response = await route.GET(localRequest("resource-1"), context("resource-1"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    code: "resource_catalog_integrity",
    error: "resource catalog unavailable",
  });
  assert.equal(JSON.stringify(body).includes("private/catalog"), false);
});

test("the detail route exports no mutation methods", () => {
  assert.equal("POST" in routeModule, false);
  assert.equal("PUT" in routeModule, false);
  assert.equal("PATCH" in routeModule, false);
  assert.equal("DELETE" in routeModule, false);
});
