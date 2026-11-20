// Boundary checks only: every case returns before the daemon is reached. The
// projection and command mapping are covered with injected clients in
// src/lib/server/automation-lifecycle.test.ts.
import assert from "node:assert/strict";
import test from "node:test";

delete process.env.COVEN_CAVE_AUTH_TOKEN;
const { GET, POST } = await import("./route.ts");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (body: unknown, host = "127.0.0.1:3000") =>
  new Request("http://127.0.0.1:3000/api/coven-automations/nightly/lifecycle", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("lifecycle commands are local-origin only", async () => {
  const response = await POST(post({ command: "pause", expectedRevision: 1, adoptionKey: "cave-0b4d3a2e-6f3c" }, "remote.example.com"), params("nightly"));
  assert.equal(response.status, 403);
});

test("a malformed command is a 400 and never reaches the daemon", async () => {
  for (const body of ["{nope", { command: "pause" }, { command: "pause", expectedRevision: 1 }, { status: "PAUSED" }]) {
    const response = await POST(post(body), params("nightly"));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { kind: "invalid" });
  }
  const badId = await POST(post({ command: "pause", expectedRevision: 1, adoptionKey: "cave-0b4d3a2e-6f3c" }), params("not an id"));
  assert.equal(badId.status, 400);
});

test("a detail read of an invalid id is a 400", async () => {
  const response = await GET(new Request("http://127.0.0.1:3000/api/coven-automations/x/lifecycle"), params("not an id"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { kind: "invalid" });
});
