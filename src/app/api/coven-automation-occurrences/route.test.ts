import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("the overview route takes no parameters and refuses them without daemon access", async () => {
  const response = await GET(new Request("http://localhost/api/coven-automation-occurrences?view=running"));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { kind: "invalid" });
});

test("a cancelled overview read is unavailable, never an empty overview", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/coven-automation-occurrences", { signal: controller.signal }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
