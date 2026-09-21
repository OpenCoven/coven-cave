import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("history route rejects invalid streams and query parameters without daemon access", async () => {
  for (const [id, query] of [["../other", ""], ["daily", "after=0"], ["daily", "checkpoint="]]) {
    const response = await GET(new Request(`http://localhost/api/coven-automations/daily/events?${query}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
});

test("an already cancelled history read cannot become an empty successful page", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/coven-automations/daily/events", { signal: controller.signal }), { params: Promise.resolve({ id: "daily" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
