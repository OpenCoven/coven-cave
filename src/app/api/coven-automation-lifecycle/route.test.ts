// Boundary checks only: invalid requests return before the daemon is reached.
import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("an overview request names 1–100 distinct, well-formed ids and nothing else", async () => {
  for (const query of ["", "?id=", "?id=a&id=a", "?id=a&cursor=1", "?id=has%20space", `?${Array.from({ length: 101 }, (_, index) => `id=a${index}`).join("&")}`]) {
    const response = await GET(new Request(`http://127.0.0.1:3000/api/coven-automation-lifecycle${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
});

test("an already cancelled read reports Coven unavailable, never an empty projection", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://127.0.0.1:3000/api/coven-automation-lifecycle?id=nightly", { signal: controller.signal }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
