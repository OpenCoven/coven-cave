import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("occurrences route refuses invalid ids and parameters without daemon access", async () => {
  for (const [id, query] of [["has space", ""], ["nightly", "after=1"], ["nightly", "cursor="], ["nightly", "cursor=a&cursor=b"]]) {
    const response = await GET(new Request(`http://localhost/api/coven-automations/x/occurrences?${query}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
});

test("a cancelled occurrences read is unavailable, never an empty page", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/coven-automations/nightly/occurrences", { signal: controller.signal }), { params: Promise.resolve({ id: "nightly" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
