import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route.ts";

test("feed route refuses malformed stream requests without daemon access", async () => {
  for (const [id, query] of [["has space", ""], ["nightly", "stream=run"], ["nightly", "stream=receipt&streamId=r"], ["nightly", "checkpoint="], ["nightly", "after=0"]]) {
    const response = await GET(new Request(`http://localhost/api/coven-automations/x/feed?${query}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
});

test("a cancelled feed read is unavailable, never a caught-up empty page", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/coven-automations/nightly/feed?checkpoint=cp", { signal: controller.signal }), { params: Promise.resolve({ id: "nightly" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { kind: "unavailable" });
});
