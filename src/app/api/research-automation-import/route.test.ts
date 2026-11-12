import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

test("legacy import refuses remote origins before reading any source", async () => {
  const response = await POST(new Request("http://localhost:3000/api/research-automation-import", {
    method: "POST", headers: { host: "localhost:3000", origin: "https://untrusted.example" },
    body: JSON.stringify({ action: "preview", id: "unused", missionId: "unused", timezone: "UTC" }),
  }));
  assert.equal(response.status, 403);
});

test("legacy apply cannot replace a frozen plan with caller-supplied metadata", async () => {
  const response = await POST(new Request("http://127.0.0.1:3000/api/research-automation-import", {
    method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    body: JSON.stringify({ action: "apply", planId: "a".repeat(64), input: { name: "changed" } }),
  }));
  assert.equal(response.status, 400);
});
