// @ts-nocheck
// Boundary checks only: every case here returns before the daemon is called
// (the routine logic is covered with an injected transport in
// src/lib/server/journal-automation-service.test.ts).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

delete process.env.COVEN_CAVE_AUTH_TOKEN;
const { GET, POST, PUT } = await import("./route.ts");
const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

const local = (method, body, host = "127.0.0.1:3000") =>
  new Request("http://127.0.0.1:3000/api/journal/automation", {
    method,
    headers: { host, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("GET rejects a missing or unsafe familiar before any daemon call", async () => {
  for (const query of ["", "?familiar=", "?familiar=..%2Fastra", "?familiar=a%2Fb"]) {
    const res = await GET(new Request(`http://127.0.0.1:3000/api/journal/automation${query}`));
    assert.equal(res.status, 400, `GET ${query || "(no familiar)"} is a 400`);
    assert.equal((await res.json()).error, "invalid familiar");
  }
});

test("mutations are local-origin only", async () => {
  for (const handler of [PUT, POST]) {
    const res = await handler(local(handler === PUT ? "PUT" : "POST", { familiar: "astra" }, "remote.example.com"));
    assert.equal(res.status, 403);
  }
});

test("PUT validates its body", async () => {
  assert.equal((await PUT(local("PUT", "{nope"))).status, 400, "malformed JSON");
  const bad = await PUT(local("PUT", { familiar: "astra", enabled: true, hour: 25, minute: 0 }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /hour must be a whole hour 0–23/);
  assert.equal((await PUT(local("PUT", { familiar: "../x", enabled: true, hour: 1, minute: 0 }))).status, 400);
});

test("POST only knows the run action", async () => {
  assert.equal((await POST(local("POST", "{nope"))).status, 400, "malformed JSON");
  const res = await POST(local("POST", { familiar: "astra", action: "delete" }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "unknown action");
  assert.equal((await POST(local("POST", { familiar: "../x", action: "run" }))).status, 400, "unsafe familiar");
});

test("the route stays a thin wrapper over the tested service", () => {
  assert.match(source, /isLocalOrigin\(req\)/, "PUT/POST keep the shared local-origin guard");
  assert.match(source, /saveJournalAutomation\(input, \{ workspaceDir \}\)/, "PUT names the familiar workspace in the prompt");
  assert.match(source, /"Cache-Control": "no-store"/, "routine state is never cached");
});
