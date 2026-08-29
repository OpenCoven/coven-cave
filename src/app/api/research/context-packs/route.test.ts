import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextPackBuilderError } from "../../../../lib/server/research-context-pack-builder.ts";
import { createContextPacksRouteHandlers } from "./route.ts";

function localRequest(method = "GET", body?: unknown): Request {
  return new Request("http://localhost:3000/api/research/context-packs", {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("flag-off returns the not-found response", async () => {
  const handlers = createContextPacksRouteHandlers({ enabled: () => false });
  const response = await handlers.GET(localRequest());
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, "context_pack_not_found");
});

test("list projects pack manifests only", async () => {
  const handlers = createContextPacksRouteHandlers({
    enabled: () => true,
    store: {
      listPacks: async () => [
        {
          schema: "opencoven.context-pack/v1",
          id: "ctx_list1",
          digest: "",
          createdAt: "2026-08-28T10:00:00.000Z",
          createdBy: { client: "coven-cave" },
          purpose: "research-run",
          subject: { familiarId: "charm" },
          consent: {
            selectionMode: "explicit",
            allowRemoteQueries: false,
            allowRemoteContent: false,
            artifactContentSync: false,
            retention: "run-only",
          },
          resources: [],
          policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: ["research-run"] },
          transforms: { secretScanVersion: "v0-none" },
        },
      ],
    },
  });
  const response = await handlers.GET(localRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.ok);
  assert.equal(body.packs.length, 1);
  assert.equal(body.packs[0].id, "ctx_list1");
});

test("seal delegates to the builder and returns the pack", async () => {
  const handlers = createContextPacksRouteHandlers({
    enabled: () => true,
    builder: {
      preview: async () => {
        throw new Error("unused");
      },
      seal: async () => ({
        schema: "opencoven.context-pack/v1",
        id: "ctx_sealed1",
        digest: "ab".repeat(32),
        createdAt: "2026-08-28T10:00:00.000Z",
        createdBy: { client: "coven-cave" },
        purpose: "research-run",
        subject: { familiarId: "charm" },
        consent: {
          selectionMode: "explicit",
          allowRemoteQueries: false,
          allowRemoteContent: false,
          artifactContentSync: false,
          retention: "run-only",
        },
        resources: [],
        policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: ["research-run"] },
        transforms: { secretScanVersion: "v0-none" },
      }),
    },
  });
  const response = await handlers.POST(
    localRequest("POST", { selection: { version: 1 } }),
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.pack.id, "ctx_sealed1");
});

test("seal maps a confirmation refusal to 409", async () => {
  const handlers = createContextPacksRouteHandlers({
    enabled: () => true,
    builder: {
      preview: async () => {
        throw new Error("unused");
      },
      seal: async () => {
        throw new ContextPackBuilderError(
          "confirmation-required",
          "sealing saved-link-abc requires explicit confirmation",
        );
      },
    },
  });
  const response = await handlers.POST(localRequest("POST", { selection: { version: 1 } }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "confirmation_required");
});

console.log("research context packs route: ok");
