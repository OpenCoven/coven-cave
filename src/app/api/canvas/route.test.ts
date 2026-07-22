// @ts-nocheck
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

const testHome = path.join(process.cwd(), ".test-artifacts", `canvas-route-${process.pid}`);
mkdirSync(testHome, { recursive: true });
process.env.COVEN_CAVE_HOME = testHome;
// Hermetic write-gate inputs: no sidecar token, permission config in the
// test home (fail-closed defaults — canvas writes from the phone are off).
delete process.env.COVEN_CAVE_AUTH_TOKEN;
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(testHome, "permission-config.json");

after(() => {
  delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  rmSync(testHome, { recursive: true, force: true });
});

const { DELETE, PATCH, POST, PUT } = await import("./route.ts");

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
  // Mutating verbs are gated by requireTrustedHumanCanvasMutation — these
  // behavioral tests exercise the store, so they call as the loopback desktop.
  return new Request("http://127.0.0.1/api/canvas", {
    method,
    headers: { "content-type": "application/json", host: "127.0.0.1:3000" },
    body: JSON.stringify(body),
  });
}

test("POST enforces exact content revisions and maps typed failures", async () => {
  const originalUpdatedAt = "2026-07-20T06:00:00Z";
  const clientUpdatedAt = "2099-07-20T07:00:00Z";

  const created = await POST(request("POST", { artifact: artifact("<main>original</main>", originalUpdatedAt) }));
  assert.equal(created.status, 200, "unguarded creates keep their existing behavior");
  const createdBody = await created.json();
  const originalRevision = createdBody.artifact.updatedAt;

  const exact = await POST(request("POST", {
    artifact: artifact("<main>revised</main>", clientUpdatedAt),
    expectedUpdatedAt: originalRevision,
  }));
  assert.equal(exact.status, 200, "an exact same-id revision succeeds");
  const exactBody = await exact.json();
  assert.ok(
    Date.parse(exactBody.artifact.updatedAt) > Date.parse(originalRevision),
    "the route returns a revision newer than the incumbent",
  );
  assert.notEqual(
    exactBody.artifact.updatedAt,
    clientUpdatedAt,
    "the route returns the server revision instead of echoing the client revision",
  );

  const stale = await POST(request("POST", {
    artifact: artifact("<main>stale</main>", "2026-07-20T08:00:00Z"),
    expectedUpdatedAt: originalRevision,
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

test("POST protects ambiguous create retries with expected-absent", async () => {
  const createdAt = "2026-07-20T15:00:00.000Z";
  const original = {
    ...artifact("<main>created</main>", createdAt),
    id: "route-expected-absent",
    createdAt,
  };
  const created = await POST(request("POST", { artifact: original, expectedAbsent: true }));
  assert.equal(created.status, 200);
  const retry = await POST(request("POST", { artifact: original, expectedAbsent: true }));
  assert.equal(retry.status, 200, "an identical create retry is idempotent");
  const conflicting = await POST(request("POST", {
    artifact: { ...original, code: "<main>changed elsewhere</main>" },
    expectedAbsent: true,
  }));
  assert.equal(conflicting.status, 409, "a create retry cannot overwrite newer same-id content");
  const invalid = await POST(request("POST", {
    artifact: original,
    expectedAbsent: true,
    expectedUpdatedAt: createdAt,
  }));
  assert.equal(invalid.status, 400, "create and revision preconditions are mutually exclusive");
});

test("every mutating verb is view-mode gated: verified phone 403s until the desktop opts in", async () => {
  const { MOBILE_ACCESS_HEADER } = await import("../../../proxy-helpers.ts");
  const { updateMobileWriteAccess } = await import("../../../lib/project-permissions.ts");
  const { GET } = await import("./route.ts");

  const mobileRequest = (method: string, body: unknown) =>
    new Request("http://100.101.102.103:8443/api/canvas", {
      method,
      headers: {
        "content-type": "application/json",
        host: "100.101.102.103:8443",
        [MOBILE_ACCESS_HEADER]: "1",
      },
      body: JSON.stringify(body),
    });

  const attempts: Array<[string, Promise<Response>]> = [
    ["PUT", PUT(mobileRequest("PUT", { positions: {} }))],
    ["POST", POST(mobileRequest("POST", { artifact: artifact("<main>phone</main>", "2026-07-22T00:00:00Z") }))],
    ["PATCH", PATCH(mobileRequest("PATCH", { id: "route-revision", annotation: annotation("a1", "2026-07-22T00:00:00Z") }))],
    ["DELETE", DELETE(mobileRequest("DELETE", { id: "route-revision" }))],
  ];
  for (const [verb, pending] of attempts) {
    const res = await pending;
    assert.equal(res.status, 403, `${verb} from the phone is refused while the opt-in is off`);
    assert.match((await res.json()).error, /Allow canvas edits from phone/, `${verb} 403 names the toggle`);
  }

  // Reading never gates — view mode keeps the gallery alive.
  const read = await GET();
  assert.equal(read.status, 200, "GET stays open regardless of the opt-in");

  // The desktop opt-in unlocks the same phone request.
  await updateMobileWriteAccess({ allowMobileCanvasWrites: true });
  const unlocked = await PUT(mobileRequest("PUT", { positions: {} }));
  assert.equal(unlocked.status, 200, "opted-in phone layout writes reach the store");
  await updateMobileWriteAccess({ allowMobileCanvasWrites: false });
});
