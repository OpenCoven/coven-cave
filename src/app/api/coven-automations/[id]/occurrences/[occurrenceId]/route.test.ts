import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("occurrence detail route refuses ids outside the grammar without daemon access", async () => {
  for (const [id, occurrenceId] of [["has space", "occ-1"], ["nightly", "../occ"], ["nightly", ""]]) {
    const response = await GET(new Request("http://localhost/api/coven-automations/x/occurrences/y"), { params: Promise.resolve({ id, occurrenceId }) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
});

test("a cancelled occurrence read is unavailable, never an absent occurrence", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/coven-automations/nightly/occurrences/occ-1", { signal: controller.signal }),
    { params: Promise.resolve({ id: "nightly", occurrenceId: "occ-1" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
