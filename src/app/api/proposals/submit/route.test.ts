import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";
import { PROPOSAL_REQUEST_MAX_BYTES } from "../../../../lib/proposal-submission.ts";

const body = { familiarId: "sage", target: "notes/today.md", contents: "synthetic" };
function request(value: unknown, extra: Record<string, string> = {}) {
  return new Request("http://localhost/api/proposals/submit", { method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...extra },
    body: JSON.stringify(value) });
}
test("submission route rejects non-local origins before body handling", async () => {
  const response = await POST(request(body, { origin: "https://attacker.example" }));
  assert.equal(response.status, 403);
});
test("submission route rejects malformed and over-budget bodies", async () => {
  for (const value of [null, [], { ...body, principalKeyFingerprint: "forged" }, { ...body, target: "../file" }]) {
    assert.equal((await POST(request(value))).status, 400);
  }
  assert.equal((await POST(request(body, { "content-length": String(PROPOSAL_REQUEST_MAX_BYTES + 1) }))).status, 413);
  assert.equal((await POST(request({ ...body, contents: "x".repeat(PROPOSAL_REQUEST_MAX_BYTES + 1) }))).status, 413);
});
test("fixture submission is refused without touching a real daemon", async () => {
  const original = process.env.COVEN_THREADS_ADAPTER;
  process.env.COVEN_THREADS_ADAPTER = "fixtures";
  try {
    const response = await POST(request(body));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { kind: "unavailable" });
  } finally {
    if (original === undefined) delete process.env.COVEN_THREADS_ADAPTER;
    else process.env.COVEN_THREADS_ADAPTER = original;
  }
});
