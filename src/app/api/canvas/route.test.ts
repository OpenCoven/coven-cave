// @ts-nocheck
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

const testHome = path.join(process.cwd(), ".test-artifacts", `canvas-route-${process.pid}`);
mkdirSync(testHome, { recursive: true });
process.env.COVEN_CAVE_HOME = testHome;

after(() => {
  rmSync(testHome, { recursive: true, force: true });
});

const { DELETE, PATCH, POST } = await import("./route.ts");

function artifact(code: string, updatedAt: string, annotations?: unknown[]) {
  return {
    id: "route-revision",
    title: "Route revision",
    prompt: "Test optimistic updates",
    code,
    kind: "html",
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt,
    ...(annotations ? { annotations } : {}),
  };
}

function annotation(id: string, updatedAt: string, note = id) {
  return {
    id,
    target: { selector: `#${id}`, label: id, excerpt: `<div id="${id}" />` },
    note,
    createdAt: updatedAt,
    updatedAt,
  };
}

function request(method: string, body: unknown) {
  return new Request("http://test/api/canvas", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST enforces exact content revisions and maps typed failures", async () => {
  const originalUpdatedAt = "2026-07-20T06:00:00Z";
  const clientUpdatedAt = "2099-07-20T07:00:00Z";

  const created = await POST(request("POST", { artifact: artifact("<main>original</main>", originalUpdatedAt) }));
  assert.equal(created.status, 200, "unguarded creates keep their existing behavior");

  const exact = await POST(request("POST", {
    artifact: artifact("<main>revised</main>", clientUpdatedAt),
    expectedUpdatedAt: originalUpdatedAt,
  }));
  assert.equal(exact.status, 200, "an exact same-id revision succeeds");
  const exactBody = await exact.json();
  assert.ok(
    Date.parse(exactBody.artifact.updatedAt) > Date.parse(originalUpdatedAt),
    "the route returns a revision newer than the incumbent",
  );
  assert.notEqual(
    exactBody.artifact.updatedAt,
    clientUpdatedAt,
    "the route returns the server revision instead of echoing the client revision",
  );

  const stale = await POST(request("POST", {
    artifact: artifact("<main>stale</main>", "2026-07-20T08:00:00Z"),
    expectedUpdatedAt: originalUpdatedAt,
  }));
  assert.equal(stale.status, 409, "a stale revision maps to HTTP 409");
  assert.equal((await stale.json()).error, "artifact changed");

  await DELETE(request("DELETE", { id: "route-revision" }));
  const missing = await POST(request("POST", {
    artifact: artifact("<main>resurrected</main>", "2026-07-20T09:00:00Z"),
    expectedUpdatedAt: exactBody.artifact.updatedAt,
  }));
  assert.equal(missing.status, 404, "a deleted revision maps to HTTP 404 instead of recreating");
  assert.equal((await missing.json()).error, "artifact not found");
});

test("POST resolves only exact annotation revisions under the content lock", async () => {
  const contentRevision = "2026-07-20T10:00:00.000Z";
  const nextRevision = "2026-07-20T11:00:00.000Z";
  const appliedAt = "2026-07-20T10:01:00.000Z";
  const concurrentAt = "2026-07-20T10:02:00.000Z";

  await POST(request("POST", {
    artifact: artifact("<main>original</main>", contentRevision, [annotation("applied", appliedAt)]),
  }));
  await PATCH(request("PATCH", {
    id: "route-revision",
    annotation: annotation("concurrent", concurrentAt),
  }));
  const saved = await POST(request("POST", {
    artifact: artifact("<main>revised</main>", nextRevision, []),
    expectedUpdatedAt: contentRevision,
    resolvedAnnotations: [{ id: "applied", updatedAt: appliedAt }],
  }));
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.deepEqual(
    savedBody.artifact.annotations.map((entry) => entry.id),
    ["concurrent"],
    "a concurrent new annotation is returned while the unchanged applied annotation is cleared",
  );

  await POST(request("POST", {
    artifact: artifact("<main>same-id original</main>", contentRevision, [annotation("same-id", appliedAt, "Original")]),
  }));
  await PATCH(request("PATCH", {
    id: "route-revision",
    annotation: annotation("same-id", concurrentAt, "Edited concurrently"),
  }));
  const sameId = await POST(request("POST", {
    artifact: artifact("<main>same-id revised</main>", nextRevision, []),
    expectedUpdatedAt: contentRevision,
    resolvedAnnotations: [{ id: "same-id", updatedAt: appliedAt }],
  }));
  assert.equal(sameId.status, 200);
  assert.equal(
    (await sameId.json()).artifact.annotations[0].note,
    "Edited concurrently",
    "a same-id concurrent edit survives",
  );
});

test("POST validates resolution tokens before writing and retains guarded failures", async () => {
  const contentRevision = "2026-07-20T12:00:00.000Z";
  await POST(request("POST", {
    artifact: artifact("<main>original</main>", contentRevision, [
      annotation("applied", "2026-07-20T12:01:00.000Z"),
    ]),
  }));

  for (const resolvedAnnotations of [
    null,
    {},
    Array.from({ length: 101 }, (_, index) => ({
      id: `id-${index}`,
      updatedAt: "2026-07-20T12:01:00.000Z",
    })),
    [{ id: "x".repeat(201), updatedAt: "2026-07-20T12:01:00.000Z" }],
    [{ id: "applied", updatedAt: "2026-07-20T12:01:00Z" }],
  ]) {
    const invalid = await POST(request("POST", {
      artifact: artifact("<main>invalid</main>", "2026-07-20T13:00:00.000Z", []),
      expectedUpdatedAt: contentRevision,
      resolvedAnnotations,
    }));
    assert.equal(invalid.status, 400, "malformed resolution tokens map to HTTP 400");
  }

  const unguarded = await POST(request("POST", {
    artifact: artifact("<main>unguarded</main>", "2026-07-20T13:00:00.000Z", []),
    resolvedAnnotations: [],
  }));
  assert.equal(unguarded.status, 400, "resolution tokens are rejected without the content guard");

  const stale = await POST(request("POST", {
    artifact: artifact("<main>stale</main>", "2026-07-20T13:00:00.000Z", []),
    expectedUpdatedAt: "2026-07-20T00:00:00.000Z",
    resolvedAnnotations: [{ id: "applied", updatedAt: "2026-07-20T12:01:00.000Z" }],
  }));
  assert.equal(stale.status, 409, "stale content still returns 409 with resolution tokens");

  await DELETE(request("DELETE", { id: "route-revision" }));
  const missing = await POST(request("POST", {
    artifact: artifact("<main>missing</main>", "2026-07-20T13:00:00.000Z", []),
    expectedUpdatedAt: contentRevision,
    resolvedAnnotations: [{ id: "applied", updatedAt: "2026-07-20T12:01:00.000Z" }],
  }));
  assert.equal(missing.status, 404, "deleted content still returns 404 with resolution tokens");
});
