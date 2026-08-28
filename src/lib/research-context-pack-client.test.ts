import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteContextPack,
  fetchContextPack,
  fetchContextPacks,
  sealContextPack,
} from "./research-context-pack-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("fetchContextPacks unwraps the packs list", async () => {
  const request = async (): Promise<Response> =>
    jsonResponse({ ok: true, packs: [{ id: "ctx_x", digest: "ab".repeat(32) }] });
  const packs = await fetchContextPacks(request as unknown as typeof fetch);
  assert.equal(packs.length, 1);
  assert.equal(packs[0]?.id, "ctx_x");
});

test("fetchContextPack throws on a missing pack", async () => {
  const request = async (): Promise<Response> => jsonResponse({ ok: true });
  await assert.rejects(() => fetchContextPack("ctx_x", request as unknown as typeof fetch));
});

test("sealContextPack posts the selection and returns the pack", async () => {
  let captured: Request | null = null;
  const request = async (input: RequestInfo | URL): Promise<Response> => {
    captured = new Request(new URL(input as string, "http://localhost"), { method: "POST", body: "{}" });
    return jsonResponse({ ok: true, pack: { id: "ctx_sealed", digest: "ab".repeat(32) } }, 201);
  };
  const pack = await sealContextPack(
    { version: 1 },
    undefined,
    request as unknown as typeof fetch,
  );
  assert.equal(pack.id, "ctx_sealed");
  assert.equal(captured?.method, "POST");
  assert.match(captured?.url ?? "", /\/api\/research\/context-packs$/);
});

test("errors surface the API error message", async () => {
  const request = async (): Promise<Response> =>
    jsonResponse({ ok: false, code: "confirmation_required", error: "confirm first" }, 409);
  await assert.rejects(
    () => sealContextPack({}, undefined, request as unknown as typeof fetch),
    (err: unknown) => (err as Error).message.includes("confirm first"),
  );
});

test("deleteContextPack reports the response status", async () => {
  const request = async (): Promise<Response> => new Response(null, { status: 200 });
  assert.equal(await deleteContextPack("ctx_x", request as unknown as typeof fetch), true);
});

console.log("research context pack client: ok");
